import React, { useState } from 'react';
import '../styles/RepeaterManager.css';

export default function RepeaterManager({ repeaters, onAdd, onRemove }) {
  const [formData, setFormData] = useState({ name: '', pubkeyPrefix: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.pubkeyPrefix.trim()) {
      alert('Beide velden zijn verplicht');
      return;
    }

    setIsSubmitting(true);
    try {
      await onAdd(formData.name, formData.pubkeyPrefix);
      setFormData({ name: '', pubkeyPrefix: '' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isOnline = (repeater) => {
    if (!repeater.last_heard) return false;
    const hoursSince = (Date.now() - new Date(repeater.last_heard)) / (1000 * 60 * 60);
    return hoursSince < 24;
  };

  return (
    <section className="repeater-manager">
      <h2>🔄 Repeater Beheer</h2>

      <form onSubmit={handleSubmit} className="repeater-form">
        <div className="form-group">
          <label htmlFor="name">Naam</label>
          <input
            id="name"
            type="text"
            placeholder="bijv. BE-ZOD-TERRIL"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={isSubmitting}
          />
        </div>

        <div className="form-group">
          <label htmlFor="pubkey">Pubkey Prefix</label>
          <input
            id="pubkey"
            type="text"
            placeholder="bijv. fc1c4b..."
            value={formData.pubkeyPrefix}
            onChange={(e) => setFormData({ ...formData, pubkeyPrefix: e.target.value })}
            disabled={isSubmitting}
          />
        </div>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Toevoegen...' : '➕ Toevoegen'}
        </button>
      </form>

      <div className="repeaters-list">
        {repeaters.length === 0 ? (
          <p className="empty-text">Geen repeaters geconfigureerd</p>
        ) : (
          repeaters.map((repeater) => (
            <div key={repeater.id} className="repeater-item">
              <div className="repeater-info">
                <strong>{repeater.name}</strong>
                <small>{repeater.pubkey_prefix || repeater.pubkey}</small>
              </div>

              <div className="repeater-status">
                <span className={`status-badge ${isOnline(repeater) ? 'online' : 'offline'}`}>
                  {isOnline(repeater) ? '🟢 Online' : '⚪ Offline'}
                </span>
                <button
                  className="btn-remove"
                  onClick={() => onRemove(repeater.id)}
                  title="Verwijderen"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
