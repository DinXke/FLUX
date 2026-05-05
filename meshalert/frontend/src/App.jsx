import { useState, useEffect } from 'react'
import LiveFeed from './components/LiveFeed'
import Timeline from './components/Timeline'
import Repeaters from './components/Repeaters'
import './styles/App.css'

function App() {
  const [activeTab, setActiveTab] = useState('live')

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🔍 MeshAlert</h1>
        <p>Mesh Network Detection Dashboard</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          Live Feed
        </button>
        <button
          className={`tab ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          Timeline
        </button>
        <button
          className={`tab ${activeTab === 'repeaters' ? 'active' : ''}`}
          onClick={() => setActiveTab('repeaters')}
        >
          Repeaters
        </button>
      </nav>

      <main className="tab-content">
        {activeTab === 'live' && <LiveFeed />}
        {activeTab === 'timeline' && <Timeline />}
        {activeTab === 'repeaters' && <Repeaters />}
      </main>
    </div>
  )
}

export default App
