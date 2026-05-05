import React from 'react';
import '../styles/NotificationSetup.css';

export default function NotificationSetup({ enabled, onRequest }) {
  const notificationsSupported = 'Notification' in window;

  return (
    <section className="notification-setup">
      <h2>🔔 Meldingen</h2>

      {!notificationsSupported ? (
        <p className="warning">Je browser ondersteunt geen meldingen</p>
      ) : (
        <div className="notification-status">
          <div className="status-info">
            <span className={`status-dot ${enabled ? 'active' : 'inactive'}`}></span>
            <span>{enabled ? 'Ingeschakeld' : 'Uitgeschakeld'}</span>
          </div>

          {!enabled && (
            <button onClick={onRequest} className="btn-enable-notifications">
              🔔 Inschakelen
            </button>
          )}

          {enabled && (
            <p className="info-text">
              Je ontvangt meldingen voor alle mesh-detecties
            </p>
          )}
        </div>
      )}
    </section>
  );
}
