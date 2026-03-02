import { useState, useRef, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()

export default function ApngMp4Converter() {
  const [files, setFiles] = useState([])
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [results, setResults] = useState([])
  const [loops, setLoops] = useState(1)
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

        if (file.name.match(/\.png$/i)) {
          // APNG → MP4（アスペクト比を保ちながら2の倍数にする）
          const outName = file.name.replace(/\.png$/i, '.mp4')
          await ffmpeg.exec([
            '-stream_loop', '-1', '-i', inName,
            '-vf', 'fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264', '-preset', 'slow',
            '-crf', '18', '-pix_fmt', 'yuv420p',
            '-t', '4', '-y', outName
          ])
          const data = await ffmpeg.readFile(outName)
          const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
          newResults.push({ name: outName, url, icon: '🎬' })
        } else {
          // MP4 → APNG（LINE入稿規定準拠・300KB以内に自動調整）
          // fps を下げながら 300KB 以内に収まるまでリトライ
          // fps=5→20枚, 4→16枚, 3→12枚, 2→8枚（規定: 5〜20枚）
          const outName = file.name.replace(/\.mp4$/i, '.png')
          const MAX_BYTES = 300 * 1024
          const fpsCandidates = [5, 4, 3, 2]
          let finalData = null

          for (const tryFps of fpsCandidates) {
            addLog(`試行中: fps=${tryFps} (${tryFps * 4}フレーム)...`)
            await ffmpeg.exec([
              '-i', inName,
              '-t', '4',
              '-vf', `fps=${tryFps},scale=600:400:force_original_aspect_ratio=decrease:flags=lanczos,pad=600:400:(ow-iw)/2:(oh-ih)/2:color=black`,
              '-f', 'apng', '-plays', String(loops), '-y', outName
            ])
            finalData = await ffmpeg.readFile(outName)
            const sizeKB = (finalData.buffer.byteLength / 1024).toFixed(0)
            if (finalData.buffer.byteLength <= MAX_BYTES) {
              addLog(`✓ fps=${tryFps}, ${sizeKB}KB / 300KB以内`)
              break
            }
            addLog(`fps=${tryFps}: ${sizeKB}KB → 超過、fps下げて再試行`)
          }

          if (finalData.buffer.byteLength > MAX_BYTES) {
            addLog(`⚠️ ${(finalData.buffer.byteLength / 1024).toFixed(0)}KB: 300KBを超えています（動画が複雑すぎる可能性）`)
          }

          const url = URL.createObjectURL(new Blob([finalData.buffer], { type: 'image/png' }))
          newResults.push({ name: outName, url, icon: '🖼️' })
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

        {hasMP4 && (
          <div className="apng-spec-row">
            <div className="apng-spec-badge">LINE規定</div>
            <span className="apng-spec-text">600×400 / 5fps / 最大4秒 / ループ:</span>
            <select className="gif-select" value={loops} onChange={e => setLoops(+e.target.value)}>
              {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}回</option>)}
            </select>
          </div>
        )}

        <div className="btn-row" style={{ marginTop: hasMP4 ? 16 : 0 }}>
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
