import { useState, useRef, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()

export default function ApngMp4Converter() {
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState('apng2mp4')
  const [fps, setFps] = useState(24)
  const [crf, setCrf] = useState(18)
  const [loops, setLoops] = useState(1)
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

  const accept = mode === 'apng2mp4' ? '.png' : '.mp4'

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDrag(false)
    const ext = mode === 'apng2mp4' ? /\.png$/i : /\.mp4$/i
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.name.match(ext))
    setFiles(p => [...p, ...dropped])
  }, [mode])

  const removeFile = (i) => setFiles(p => p.filter((_, idx) => idx !== i))

  const switchMode = (m) => { setMode(m); setFiles([]); setResults([]); setLog('') }

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

        if (mode === 'apng2mp4') {
          const outName = file.name.replace(/\.png$/i, '.mp4')
          await ffmpeg.exec([
            '-stream_loop', '-1', '-i', inName,
            '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
            '-c:v', 'libx264', '-preset', 'slow',
            '-crf', String(crf), '-pix_fmt', 'yuv420p',
            '-t', String(loops * 2), '-y', outName
          ])
          const data = await ffmpeg.readFile(outName)
          const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }))
          newResults.push({ name: outName, url, icon: '🎬' })
        } else {
          const outName = file.name.replace(/\.mp4$/i, '.png')
          await ffmpeg.exec([
            '-i', inName,
            '-vf', `fps=${fps},scale=600:400:flags=lanczos`,
            '-f', 'apng', '-plays', String(loops), '-y', outName
          ])
          const data = await ffmpeg.readFile(outName)
          const url = URL.createObjectURL(new Blob([data.buffer], { type: 'image/png' }))
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

  return (
    <div>
      <div className="card">
        <div className="card-title">変換モード</div>
        <div className="mode-switch">
          <button className={`mode-btn ${mode === 'apng2mp4' ? 'active' : ''}`} onClick={() => switchMode('apng2mp4')}>
            🖼️ APNG → MP4
          </button>
          <button className={`mode-btn ${mode === 'mp42apng' ? 'active' : ''}`} onClick={() => switchMode('mp42apng')}>
            🎬 MP4 → APNG
          </button>
        </div>

        <div
          className={`drop-area ${drag ? 'drag' : ''}`}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onClick={() => inputRef.current.click()}
        >
          <div className="drop-icon">{mode === 'apng2mp4' ? '🖼️' : '🎬'}</div>
          <h3>ファイルをここにドロップ</h3>
          <p>{mode === 'apng2mp4' ? 'APNG（.png）' : 'MP4（.mp4）'} ファイルに対応　　クリックしてファイルを選択</p>
          <input ref={inputRef} type="file" accept={accept} multiple hidden
            onChange={e => setFiles(p => [...p, ...Array.from(e.target.files)])} />
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-item">
                <span className="file-icon">{mode === 'apng2mp4' ? '🖼️' : '🎬'}</span>
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
            <label>フレームレート</label>
            <select value={fps} onChange={e => setFps(e.target.value)}>
              {[15, 24, 30].map(v => <option key={v}>{v} fps</option>)}
            </select>
          </div>
          {mode === 'apng2mp4' && (
            <div className="setting-item">
              <label>CRF（画質 0〜51）</label>
              <input type="number" value={crf} min={0} max={51} onChange={e => setCrf(e.target.value)} />
            </div>
          )}
          <div className="setting-item">
            <label>ループ回数</label>
            <input type="number" value={loops} min={1} max={4} onChange={e => setLoops(e.target.value)} />
          </div>
        </div>

        <div className="btn-row">
          <button className="btn-primary" onClick={convert} disabled={loading || !files.length}>
            {loading
              ? <><span className="spinner" /> 変換中...</>
              : `🔄  ${mode === 'apng2mp4' ? 'MP4' : 'APNG'} に変換`}
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
