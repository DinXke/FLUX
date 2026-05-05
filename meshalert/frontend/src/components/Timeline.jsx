import { useState, useEffect } from 'react'
import '../styles/Timeline.css'

function Timeline() {
  const [detections, setDetections] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [repeaters, setRepeaters] = useState([])

  // Filters
  const [selectedRepeater, setSelectedRepeater] = useState('')
  const [timeRange, setTimeRange] = useState('all')

  const PAGE_SIZE = 100

  useEffect(() => {
    fetchRepeaters()
  }, [])

  useEffect(() => {
    fetchDetections()
  }, [page, selectedRepeater, timeRange])

  async function fetchRepeaters() {
    try {
      const res = await fetch('/api/detections/repeaters')
      if (res.ok) {
        const data = await res.json()
        setRepeaters(data.repeaters || [])
      }
    } catch (e) {
      console.error('Failed to fetch repeaters:', e)
    }
  }

  async function fetchDetections() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(selectedRepeater && { repeater: selectedRepeater }),
        ...(timeRange !== 'all' && { timeRange }),
      })

      const res = await fetch(`/api/detections/history?${params}`)
      if (res.ok) {
        const data = await res.json()
        setDetections(data.detections || [])
        setTotalCount(data.total || 0)
      }
    } catch (e) {
      console.error('Failed to fetch detections:', e)
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="timeline">
      <div className="filters">
        <div className="filter-group">
          <label htmlFor="repeater">Repeater:</label>
          <select
            id="repeater"
            value={selectedRepeater}
            onChange={(e) => {
              setSelectedRepeater(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All Repeaters</option>
            {repeaters.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="timerange">Time Range:</label>
          <select
            id="timerange"
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value)
              setPage(0)
            }}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        <div className="result-count">
          {totalCount} detections found
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading detections...</div>
      ) : detections.length === 0 ? (
        <div className="empty-state">No detections found</div>
      ) : (
        <>
          <div className="timeline-table">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Node</th>
                  <th>RSSI (dBm)</th>
                  <th>Observer</th>
                  <th>Path Hops</th>
                </tr>
              </thead>
              <tbody>
                {detections.map((det, idx) => (
                  <tr key={idx}>
                    <td>{new Date(det.timestamp).toLocaleString()}</td>
                    <td className="node-cell">{det.node}</td>
                    <td className={`rssi-cell rssi-${getRSSILevel(det.rssi)}`}>
                      {det.rssi}
                    </td>
                    <td>{det.observer}</td>
                    <td className="path-cell">{det.path?.length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
            >
              ← Previous
            </button>
            <span className="page-info">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function getRSSILevel(rssi) {
  if (rssi > -70) return 'strong'
  if (rssi > -85) return 'good'
  if (rssi > -100) return 'weak'
  return 'poor'
}

export default Timeline
