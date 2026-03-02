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

const PRESETS = [
  { label: '600×400', w: 600, h: 400 },
  { label: '300×250', w: 300, h: 250 },
]
const FPS_OPTIONS = [5, 8, 10, 15, 20, 30]

export default function GifConverter() {
  const [files, setFiles] = useState([])
  const [settings, setSettings] = useState({
    width: 300,
    height: 250,
    fps: 20,
    outputName: 'output',
  })
  const [lockAspect, setLockAspect] = useState(false)
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [results, setResults] = useState([])
  const inputRef = useRef()

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

  const handleWidthChange = (val) => {
    const w = val ? Number(val) : null
    if (lockAspect && w && settings.height) {
      setSettings(s => ({ ...s, width: w, height: null }))
    } else {
      setSettings(s => ({ ...s, width: w }))
    }
  }

  const handleHeightChange = (val) => {
    const h = val ? Number(val) : null
    if (lockAspect && h && settings.width) {
      setSettings(s => ({ ...s, height: h, width: null }))
    } else {
      setSettings(s => ({ ...s, height: h }))
    }
  }

  // 元のツールと同じフィルターグラフ構築
  const buildFilterGraph = (fps, width, height) => {
    const fpsFilter = `fps=${fps}`
    let scaleFilter = ''
    if (width && height) scaleFilter = `,scale=${width}:${height}:flags=lanczos`
    else if (width)       scaleFilter = `,scale=${width}:-2:flags=lanczos`
    else if (height)      scaleFilter = `,scale=-2:${height}:flags=lanczos`
    return fpsFilter + scaleFilter
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
        const yymmdd = getYYMMDD()
        const baseName = files.length === 1
          ? settings.outputName
          : file.name.replace(/\.[^.]+$/, '')
        const outName = `${baseName}_${yymmdd}_GIF.gif`
        const paletteName = `palette_${Date.now()}.png`
        await ffmpeg.writeFile(inName, await fetchFile(file))

        const fg = buildFilterGraph(settings.fps, settings.width, settings.height)

        // Pass 1: パレット生成 (元のツールと同じ stats_mode=diff)
        addLog('パレット生成中...')
        await ffmpeg.exec([
          '-i', inName,
          '-vf', `${fg},palettegen=stats_mode=diff`,
          '-y', paletteName,
        ])

        // Pass 2: パレット適用 (元のツールと同じ dither=bayer:bayer_scale=5)
        addLog('GIF変換中...')
        await ffmpeg.exec([
          '-i', inName,
          '-i', paletteName,
          '-lavfi', `[0:v] ${fg} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
          '-y', outName,
        ])

        const data = await ffmpeg.readFile(outName)
        const sizeKB = (data.buffer.byteLength / 1024).toFixed(0)
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'image/gif' }))
        newResults.push({ name: outName, url })
        addLog(`完了: ${outName} (${sizeKB}KB) ✓`)
      }
      setResults(newResults)
    } catch (e) {
      addLog('エラー: ' + e.message)
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">ファイルを選択</div>
        <div
          className={`drop-area ${drag ? 'drag' : ''}`}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onClick={() => inputRef.current.click()}
        >
          <div className="drop-icon">🎬</div>
          <h3>ファイルをここにドロップ</h3>
          <p>MP4 / APNG に対応　　クリックしてファイルを選択</p>
          <input ref={inputRef} type="file" accept=".mp4,.png" multiple hidden
            onChange={e => setFiles(p => [...p, ...Array.from(e.target.files)])} />
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-item">
                <span className="file-icon">{f.name.endsWith('.mp4') ? '🎬' : '🖼️'}</span>
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                  <div className="file-size">{(f.size / 1024).toFixed(0)} KB</div>
                </div>
                <button className="file-remove" onClick={() => removeFile(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="gif-settings">
          <div className="gif-row">
            <span className="gif-label">リサイズ:</span>
            <input
              className="gif-num" type="number" min="80" max="1920"
              value={settings.width ?? ''} placeholder="自動"
              onChange={e => handleWidthChange(e.target.value)}
            />
            <button
              className={`gif-lock-btn ${lockAspect ? 'active' : ''}`}
              onClick={() => setLockAspect(v => !v)}
              title={lockAspect ? '縦横比維持中（クリックで解除）' : 'クリックで縦横比維持'}
            >🔒</button>
            <input
              className="gif-num" type="number" min="60" max="1080"
              value={settings.height ?? ''} placeholder="自動"
              onChange={e => handleHeightChange(e.target.value)}
            />
            <span className="gif-hint">{lockAspect ? '縦横比維持' : '自由変形'}</span>
            {PRESETS.map(p => (
              <button key={p.label} className="gif-preset"
                onClick={() => setSettings(s => ({ ...s, width: p.w, height: p.h }))}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="gif-row">
            <span className="gif-label">FPS:</span>
            <select className="gif-select" value={settings.fps}
              onChange={e => setSettings(s => ({ ...s, fps: Number(e.target.value) }))}>
              {FPS_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <span className="gif-label" style={{ marginLeft: 16 }}>出力名:</span>
            <input className="gif-name" type="text" value={settings.outputName} placeholder="output"
              onChange={e => setSettings(s => ({ ...s, outputName: e.target.value || 'output' }))} />
            <span className="gif-ext">.gif</span>
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 20 }}>
          <button className="btn-primary" onClick={convert} disabled={loading || !files.length}>
            {loading ? <><span className="spinner" /> 変換中...</> : '🎞️  GIF変換を開始'}
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
                <span className="download-item-icon">🎞️</span>
                <div className="download-item-info">
                  <div className="download-item-name">{r.name}</div>
                  <div className="download-item-label">クリックしてダウンロード</div>
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
