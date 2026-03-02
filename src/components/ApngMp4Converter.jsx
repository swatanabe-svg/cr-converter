import { useState, useRef, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()

const getYYMMDD = () => {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

const FPS_OPTIONS = [5, 8, 10, 15, 20]
const SPEED_OPTIONS = [
  { value: 0.5,  label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1,    label: '1.0x' },
  { value: 1.5,  label: '1.5x' },
  { value: 2,    label: '2.0x' },
]
const LOOP_OPTIONS = [1, 2, 3, 4]
const MP4_DURATION_OPTIONS = [
  { value: 15, label: '15秒' },
  { value: 30, label: '30秒' },
]
const PRESETS = [
  { label: '600×400', w: 600, h: 400 },
  { label: '300×250', w: 300, h: 250 },
]

export default function ApngMp4Converter() {
  const [files, setFiles] = useState([])
  const [settings, setSettings] = useState({
    outputWidth: 600,
    outputHeight: 400,
    fps: 5,
    loopCount: 4,
    speed: 1,
    mp4Duration: 15,
    outputName: 'output',
  })
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [results, setResults] = useState([])
  const inputRef = useRef()

  const set = (key, val) => setSettings(s => ({ ...s, [key]: val }))
  const addLog = (msg) => setLog(p => p + '\n' + msg)

  const loadFFmpeg = async () => {
    if (ffmpeg.loaded) return
    addLog('ffmpeg 読み込み中...')
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    addLog('ffmpeg 準備完了 ✓')
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDrag(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.name.match(/\.(mp4|png)$/i))
    setFiles(p => [...p, ...dropped])
  }, [])

  const removeFile = (i) => setFiles(p => p.filter((_, idx) => idx !== i))

  // 元のツールと同じ二分探索圧縮 (lo=8, hi=256, target=299KB)
  // filter: split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=floyd_steinberg
  const compressApng = async (inName, outName, loopCount) => {
    const MAX_BYTES = 299 * 1024
    let lo = 8, hi = 256, bestData = null
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      addLog(`  色数 ${mid} を試行中...`)
      const vf = `split[a][b];[a]palettegen=max_colors=${mid}:stats_mode=diff[p];[b][p]paletteuse=dither=floyd_steinberg`
      await ffmpeg.exec([
        '-i', inName, '-vf', vf,
        '-f', 'apng', '-plays', String(loopCount), '-y', outName,
      ])
      const data = await ffmpeg.readFile(outName)
      if (data.buffer.byteLength <= MAX_BYTES) {
        bestData = data
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return bestData
  }

  const convert = async () => {
    if (!files.length) return
    setLoading(true)
    setResults([])
    setLog('')
    try {
      await loadFFmpeg()
      const newResults = []
      for (const file of files) {
        addLog(`変換中: ${file.name}`)
        const inName = file.name
        await ffmpeg.writeFile(inName, await fetchFile(file))

        const yymmdd = getYYMMDD()
        if (file.name.match(/\.png$/i)) {
          // ── APNG → MP4 ──────────────────────────────────────────
          // 元のツール: 固定1920×1080, libx264, preset=slow, crf=18, yuv420p
          const baseName = files.length === 1
            ? settings.outputName
            : file.name.replace(/\.png$/i, '')
          const outName = `${baseName}_${yymmdd}_APNG動画.mp4`
          addLog(`APNG → MP4 (${settings.mp4Duration}秒, 1920×1080)`)
          await ffmpeg.exec([
            '-stream_loop', '-1',
            '-i', inName,
            '-vf', 'scale=1920:1080:flags=lanczos',
            '-c:v', 'libx264',
            '-preset', 'slow',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-t', String(settings.mp4Duration),
            '-y', outName,
          ])
          const data = await ffmpeg.readFile(outName)
          const sizeKB = (data.buffer.byteLength / 1024 / 1024).toFixed(1)
          const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
          newResults.push({ name: outName, url, icon: '🎬', size: `${sizeKB}MB` })

        } else {
          // ── MP4 → APNG ──────────────────────────────────────────
          // 元のツール: 指定サイズ・fps・loopCount、targetMaxBytes=300KB
          const baseName = files.length === 1
            ? settings.outputName
            : file.name.replace(/\.mp4$/i, '')
          const outName = `${baseName}_${yymmdd}_APNG.png`
          const tempApng = `_tmp_${Date.now()}.png`

          // 元のツールと同じ: sourceDuration = 1 / speed を -i の前に指定
          // speed=1(デフォルト) → 1秒読み込み → fps=10で10フレーム
          const sourceDuration = 1 / settings.speed
          const speedFilter = Math.abs(settings.speed - 1) > 0.001
            ? `setpts=PTS/${settings.speed},` : ''
          const vf = `${speedFilter}fps=${settings.fps},scale=${settings.outputWidth}:${settings.outputHeight}:flags=lanczos`
          const frameCount = Math.round(settings.fps * sourceDuration)

          addLog(`MP4 → APNG (${settings.outputWidth}×${settings.outputHeight}, fps=${settings.fps}, ${sourceDuration}秒, ${frameCount}フレーム)`)
          await ffmpeg.exec([
            '-t', String(sourceDuration),  // -i の前 = 入力時間制限（元のツールと同じ）
            '-i', inName,
            '-vf', vf,
            '-f', 'apng',
            '-plays', String(settings.loopCount),
            '-y', tempApng,
          ])

          const rawData = await ffmpeg.readFile(tempApng)
          const rawKB = (rawData.buffer.byteLength / 1024).toFixed(0)

          let finalData
          if (rawData.buffer.byteLength <= 299 * 1024) {
            addLog(`✓ ${rawKB}KB / 300KB以内`)
            finalData = rawData
            // outName にコピー
            await ffmpeg.writeFile(outName, new Uint8Array(rawData.buffer))
          } else {
            addLog(`${rawKB}KB → 300KB以内に圧縮中 (二分探索: 8〜256色)`)
            finalData = await compressApng(tempApng, outName, settings.loopCount)
            if (!finalData) {
              addLog('⚠️ 8色でも300KB以内に収まりませんでした')
              finalData = await ffmpeg.readFile(outName)
            }
            const compKB = (finalData.buffer.byteLength / 1024).toFixed(0)
            addLog(`✓ ${compKB}KB`)
          }

          const url = URL.createObjectURL(new Blob([finalData.buffer], { type: 'image/png' }))
          newResults.push({ name: outName, url, icon: '🖼️', size: `${(finalData.buffer.byteLength / 1024).toFixed(0)}KB` })
        }
        addLog(`完了: ${file.name} ✓`)
      }
      setResults(newResults)
    } catch (e) {
      addLog('エラー: ' + e.message)
    }
    setLoading(false)
  }

  const hasMP4 = files.some(f => f.name.match(/\.mp4$/i))
  const hasPNG = files.some(f => f.name.match(/\.png$/i))

  return (
    <div>
      <div className="card">
        <div
          className={`drop-area ${drag ? 'drag' : ''}`}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onClick={() => inputRef.current.click()}
        >
          <div className="drop-icon">🔄</div>
          <h3>MP4 / APNG ファイルをここにドロップ</h3>
          <p>ファイル形式を自動判別して変換します　　クリックしてファイルを選択</p>
          <input ref={inputRef} type="file" accept=".mp4,.png" multiple hidden
            onChange={e => setFiles(p => [...p, ...Array.from(e.target.files)])} />
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-item">
                <span className="file-icon">{f.name.match(/\.mp4$/i) ? '🎬' : '🖼️'}</span>
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                  <div className="file-size">
                    {(f.size / 1024).toFixed(0)} KB　→　{f.name.match(/\.mp4$/i) ? 'APNG に変換' : 'MP4 に変換'}
                  </div>
                </div>
                <button className="file-remove" onClick={() => removeFile(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MP4→APNG 設定 */}
      {hasMP4 && (
        <div className="card">
          <div className="card-title">MP4 → APNG 設定</div>
          <div className="gif-settings">
            <div className="gif-row">
              <span className="gif-label">サイズ:</span>
              <input className="gif-num" type="number" value={settings.outputWidth}
                onChange={e => set('outputWidth', Number(e.target.value) || 600)} min="80" max="1920" />
              <span className="gif-lock" style={{ color: '#475569' }}>×</span>
              <input className="gif-num" type="number" value={settings.outputHeight}
                onChange={e => set('outputHeight', Number(e.target.value) || 400)} min="60" max="1080" />
              {PRESETS.map(p => (
                <button key={p.label} className="gif-preset"
                  onClick={() => setSettings(s => ({ ...s, outputWidth: p.w, outputHeight: p.h }))}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="gif-row">
              <span className="gif-label">FPS:</span>
              <select className="gif-select" value={settings.fps}
                onChange={e => set('fps', Number(e.target.value))}>
                {FPS_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <span className="gif-label" style={{ marginLeft: 16 }}>ループ:</span>
              <select className="gif-select" value={settings.loopCount}
                onChange={e => set('loopCount', Number(e.target.value))}>
                {LOOP_OPTIONS.map(v => <option key={v} value={v}>{v}回</option>)}
              </select>
              <span className="gif-label" style={{ marginLeft: 16 }}>速度:</span>
              <select className="gif-select" value={settings.speed}
                onChange={e => set('speed', Number(e.target.value))}>
                {SPEED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {(() => {
                // 元のツールと同じ計算:
                // sourceDuration = 1/speed, setpts=PTS/speed → outputDuration = 1/speed²
                // frames = fps × outputDuration = fps/speed²
                const outputDuration = 1 / (settings.speed ** 2)
                const frames = Math.round(settings.fps / (settings.speed ** 2))
                const inSpec = frames >= 5 && frames <= 20 && outputDuration >= 1 && outputDuration <= 4
                return (
                  <span className={`gif-hint ${!inSpec ? 'spec-warn' : ''}`} style={{ marginLeft: 12 }}>
                    → {outputDuration.toFixed(2)}秒 / {frames}フレーム
                    {frames < 5 && ' ⚠️ LINE規定: 最小5フレーム'}
                    {frames > 20 && ' ⚠️ LINE規定: 最大20フレーム'}
                    {outputDuration > 4 && ' ⚠️ LINE規定: 最大4秒'}
                  </span>
                )
              })()}
            </div>
            <div className="gif-row">
              <span className="gif-label">出力名:</span>
              <input className="gif-name" type="text" value={settings.outputName} placeholder="output"
                onChange={e => set('outputName', e.target.value || 'output')} />
              <span className="gif-ext">.png</span>
              <span className="apng-spec-badge" style={{ marginLeft: 8 }}>300KB自動圧縮</span>
            </div>
          </div>
        </div>
      )}

      {/* APNG→MP4 設定 */}
      {hasPNG && (
        <div className="card">
          <div className="card-title">APNG → MP4 設定</div>
          <div className="gif-settings">
            <div className="gif-row">
              <span className="gif-label">出力秒数:</span>
              <select className="gif-select" value={settings.mp4Duration}
                onChange={e => set('mp4Duration', Number(e.target.value))}>
                {MP4_DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="gif-hint" style={{ marginLeft: 8 }}>1920×1080 / H.264 / CRF18</span>
            </div>
            <div className="gif-row">
              <span className="gif-label">出力名:</span>
              <input className="gif-name" type="text" value={settings.outputName} placeholder="output"
                onChange={e => set('outputName', e.target.value || 'output')} />
              <span className="gif-ext">.mp4</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="btn-row">
          <button className="btn-primary" onClick={convert} disabled={loading || !files.length}>
            {loading ? <><span className="spinner" /> 変換中...</> : '🔄  変換開始'}
          </button>
          <button className="btn-ghost" onClick={() => { setFiles([]); setResults([]); setLog('') }}>
            クリア
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="card">
          <div className="card-title">ダウンロード</div>
          <div className="download-list">
            {results.map((r, i) => (
              <a key={i} href={r.url} download={r.name} className="download-item">
                <span className="download-item-icon">{r.icon}</span>
                <div className="download-item-info">
                  <div className="download-item-name">{r.name}</div>
                  <div className="download-item-label">クリックしてダウンロード {r.size && `(${r.size})`}</div>
                </div>
                <span className="download-arrow">↓</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {log && <div className="log-box">{log}</div>}
    </div>
  )
}
