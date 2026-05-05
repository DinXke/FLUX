import { useState, useEffect } from 'react'
import '../styles/LiveFeed.css'

function LiveFeed() {
  const [detections, setDetections] = useState([])
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    const eventSource = new EventSource('/api/detections/stream')

    eventSource.addEventListener('detection', (event) => {
      try {
        const detection = JSON.parse(event.data)
        setDetections((prev) => [detection, ...prev.slice(0, 9)])
        setStatus('connected')
      } catch (e) {
        console.error('Failed to parse detection:', e)
      }
    })

    eventSource.addEventListener('error', () => {
      setStatus('disconnected')
    })

    return () => eventSource.close()
  }, [])

  return (
    <div className="live-feed">
      <div className="live-header">
        <h2>Real-time Detection Feed</h2>
        <div className={`status ${status}`}>
          <span className="dot"></span>
          {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
        </div>
      </div>

      <div className="detections-list">
        {detections.length === 0 ? (
          <div className="empty-state">Waiting for detections...</div>
        ) : (
          detections.map((det, idx) => (
            <div key={idx} className="detection-card">
              <div className="detection-header">
                <span className="node-name">{det.node}</span>
                <span className="timestamp">{new Date(det.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="detection-details">
                <div className="detail-row">
                  <span className="label">RSSI:</span>
                  <span className="value">{det.rssi} dBm</span>
                </div>
                <div className="detail-row">
                  <span className="label">Observer:</span>
                  <span className="value">{det.observer}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Path Hops:</span>
                  <span className="value">{det.path?.length || 0}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LiveFeed
