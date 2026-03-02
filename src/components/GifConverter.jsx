import { useState, useRef, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()

export default function GifConverter() {
  const [files, setFiles] = useState([])
  const [width, setWidth] = useState(600)
  const [height, setHeight] = useState(400)
  const [fps, setFps] = useState(20)
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
        const outName = file.name.replace(/\.[^.]+$/, '.gif')
        await ffmpeg.writeFile(inName, await fetchFile(file))
        await ffmpeg.exec([
          '-i', inName,
          '-vf', `fps=${fps},scale=${width}:${height}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          '-y', outName
        ])
        const data = await ffmpeg.readFile(outName)
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'image/gif' }))
        newResults.push({ name: outName, url })
        addLog(`完了: ${outName} ✓`)
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
          <p>MP4 / APNG に対応 　クリックしてファイルを選択</p>
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
        <div className="card-title">出力設定</div>
        <div className="settings-grid">
          <div className="setting-item">
            <label>幅 (px)</label>
            <input type="number" value={width} onChange={e => setWidth(e.target.value)} />
          </div>
          <div className="setting-item">
            <label>高さ (px)</label>
            <input type="number" value={height} onChange={e => setHeight(e.target.value)} />
          </div>
          <div className="setting-item">
            <label>フレームレート</label>
            <select value={fps} onChange={e => setFps(e.target.value)}>
              {[10, 15, 20, 24, 30].map(v => <option key={v}>{v} fps</option>)}
            </select>
          </div>
        </div>

        <div className="btn-row">
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
