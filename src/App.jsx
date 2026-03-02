import { useState } from 'react'
import GifConverter from './components/GifConverter'
import ApngMp4Converter from './components/ApngMp4Converter'
import './App.css'

const TABS = [
  { id: 'gif', label: 'GIF 変換', icon: '🎞️', desc: 'MP4・APNGをGIFに変換' },
  { id: 'apng', label: 'APNG ↔ MP4', icon: '🔄', desc: 'APNGとMP4を相互変換' },
]

export default function App() {
  const [tab, setTab] = useState('gif')
  const current = TABS.find(t => t.id === tab)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>CR 変換ツール</h1>
          <p>Creative Converter</p>
        </div>
        <nav className="sidebar-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <div className="page-header">
          <h2>{current.label}</h2>
          <p>{current.desc}</p>
        </div>
        {tab === 'gif' && <GifConverter />}
        {tab === 'apng' && <ApngMp4Converter />}
      </main>
    </div>
  )
}
