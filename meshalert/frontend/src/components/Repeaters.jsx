import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import '../styles/Repeaters.css'

function Repeaters() {
  const [userId, setUserId] = useState(null)
  const [myRepeaters, setMyRepeaters] = useState([])
  const [publicRepeaters, setPublicRepeaters] = useState([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPubkey, setNewPubkey] = useState('')
  const [newIsPublic, setNewIsPublic] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [alertsState, setAlertsState] = useState({})

  useEffect(() => {
    const id = getOrCreateUserId()
    setUserId(id)
    loadAlertsState()
    fetchRepeaters(id)
    const interval = setInterval(() => fetchRepeaters(id), 5000)
    return () => clearInterval(interval)
  }, [])

  function getOrCreateUserId() {
    let id = localStorage.getItem('meshalert_user_id')
    if (!id) {
      id = uuidv4()
      localStorage.setItem('meshalert_user_id', id)
    }
    return id
  }

  function loadAlertsState() {
    const stored = localStorage.getItem('meshalert_personal_prefs')
    if (stored) {
      try {
        const prefs = JSON.parse(stored)
        setAlertsState(prefs.alerts || {})
      } catch (e) {
        console.error('Failed to parse stored prefs:', e)
      }
    }
  }

  function saveAlertsState(newAlerts) {
    const stored = localStorage.getItem('meshalert_personal_prefs')
    let prefs = { alerts: newAlerts }
    if (stored) {
      try {
        prefs = { ...JSON.parse(stored), alerts: newAlerts }
      } catch (e) {
        console.error('Failed to parse stored prefs:', e)
      }
    }
    localStorage.setItem('meshalert_personal_prefs', JSON.stringify(prefs))
    setAlertsState(newAlerts)
  }

  async function fetchRepeaters(id) {
    if (!id) return
    try {
      const res = await fetch(`/api/repeaters?user_id=${id}`)
      if (res.ok) {
        const data = await res.json()
        setMyRepeaters(data.mine || [])
        setPublicRepeaters(data.public || [])
      }
    } catch (e) {
      console.error('Failed to fetch repeaters:', e)
    }
  }

  async function handleAddRepeater(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!newName.trim() || !newPubkey.trim()) {
      setError('Name and public key are required')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/repeaters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          pubkey_prefix: newPubkey.trim(),
          is_public: newIsPublic,
          user_id: userId,
        }),
      })

      if (res.ok) {
        setSuccess('Repeater added successfully')
        setNewName('')
        setNewPubkey('')
        setNewIsPublic(false)
        await fetchRepeaters(userId)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to add repeater')
      }
    } catch (e) {
      setError('Error adding repeater: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteRepeater(id) {
    if (!confirm('Delete this repeater?')) return

    try {
      const res = await fetch(`/api/repeaters/${id}?user_id=${userId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSuccess('Repeater deleted')
        await fetchRepeaters(userId)
      } else {
        setError('Failed to delete repeater')
      }
    } catch (e) {
      setError('Error deleting repeater: ' + e.message)
    }
  }

  async function handleTogglePublic(id, currentPublic) {
    try {
      const res = await fetch(`/api/repeaters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_public: !currentPublic,
          user_id: userId,
        }),
      })

      if (res.ok) {
        await fetchRepeaters(userId)
      } else {
        setError('Failed to toggle public status')
      }
    } catch (e) {
      setError('Error toggling public status: ' + e.message)
    }
  }

  function handleToggleAlert(repeaterId, enabled) {
    const newAlerts = { ...alertsState }
    if (enabled) {
      newAlerts[repeaterId] = 'on'
    } else {
      delete newAlerts[repeaterId]
    }
    saveAlertsState(newAlerts)
  }

  function isAlertEnabled(repeaterId) {
    return alertsState[repeaterId] === 'on'
  }

  function getStatus(lastSeen) {
    if (!lastSeen) return 'offline'
    const diff = Date.now() - new Date(lastSeen).getTime()
    const hoursAgo = diff / (1000 * 60 * 60)
    return hoursAgo < 24 ? 'online' : 'offline'
  }

  return (
    <div className="repeaters">
      <div className="repeaters-header">
        <h2>Repeater Management</h2>
        <p className="subtitle">Add and manage mesh network repeaters with alerts</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form className="add-repeater-form" onSubmit={handleAddRepeater}>
        <div className="form-group">
          <label htmlFor="name">Repeater Name</label>
          <input
            id="name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g., BE-ZOD-MT-ZOLDER"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="pubkey">Public Key (prefix or full)</label>
          <input
            id="pubkey"
            type="text"
            value={newPubkey}
            onChange={(e) => setNewPubkey(e.target.value)}
            placeholder="e.g., fc1c4b or full hex key"
            disabled={loading}
          />
        </div>

        <div className="form-group checkbox-group">
          <label htmlFor="public">
            <input
              id="public"
              type="checkbox"
              checked={newIsPublic}
              onChange={(e) => setNewIsPublic(e.target.checked)}
              disabled={loading}
            />
            Make Public
          </label>
        </div>

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Adding...' : 'Add Repeater'}
        </button>
      </form>

      <div className="repeaters-section">
        <h3 className="section-title">Mijn Repeaters</h3>
        <div className="repeaters-table">
          {myRepeaters.length === 0 ? (
            <div className="empty-state">No personal repeaters yet. Add one above!</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Public Key</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                  <th>Public</th>
                  <th>Alerts</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {myRepeaters.map((r) => (
                  <tr key={r.id}>
                    <td className="repeater-name">{r.name}</td>
                    <td className="pubkey-cell">{r.pubkey_prefix}</td>
                    <td>
                      <span className={`status-badge status-${getStatus(r.last_seen)}`}>
                        {getStatus(r.last_seen) === 'online' ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td className="timestamp-cell">
                      {r.last_seen ? new Date(r.last_seen).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <button
                        className={`btn-toggle ${r.is_public ? 'active' : ''}`}
                        onClick={() => handleTogglePublic(r.id, r.is_public)}
                        disabled={loading}
                      >
                        {r.is_public ? '🔓 Public' : '🔒 Private'}
                      </button>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={isAlertEnabled(r.id)}
                        onChange={(e) => handleToggleAlert(r.id, e.target.checked)}
                        title="Enable/disable alerts for this repeater"
                      />
                    </td>
                    <td>
                      <button
                        className="btn-delete"
                        onClick={() => handleDeleteRepeater(r.id)}
                        disabled={loading}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="repeaters-section">
        <h3 className="section-title">Publieke Repeaters</h3>
        <div className="repeaters-table">
          {publicRepeaters.length === 0 ? (
            <div className="empty-state">No public repeaters available</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Public Key</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                  <th>Alerts</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {publicRepeaters.map((r) => (
                  <tr key={r.id}>
                    <td className="repeater-name">{r.name}</td>
                    <td className="owner-cell">{r.owner_id === userId ? 'You' : 'Other'}</td>
                    <td className="pubkey-cell">{r.pubkey_prefix}</td>
                    <td>
                      <span className={`status-badge status-${getStatus(r.last_seen)}`}>
                        {getStatus(r.last_seen) === 'online' ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td className="timestamp-cell">
                      {r.last_seen ? new Date(r.last_seen).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={isAlertEnabled(r.id)}
                        onChange={(e) => handleToggleAlert(r.id, e.target.checked)}
                        title="Enable/disable alerts for this repeater"
                      />
                    </td>
                    <td>
                      {r.owner_id === userId && (
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteRepeater(r.id)}
                          disabled={loading}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default Repeaters
