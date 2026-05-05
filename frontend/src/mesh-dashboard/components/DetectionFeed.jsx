import React from 'react';
import '../styles/DetectionFeed.css';

export default function DetectionFeed({ detections }) {
  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getRSSIColor = (rssi) => {
    if (rssi > -80) return '#22c55e'; // groen
    if (rssi > -90) return '#eab308'; // geel
    return '#ef4444'; // rood
  };

  return (
    <section className="detection-feed">
      <h2>📡 Live Detecties (max 10)</h2>
      <div className="detections-list">
        {detections.length === 0 ? (
          <div className="empty-state">
            <p>Wachten op detecties...</p>
            <p className="hint">De live feed zal hier verschijnen</p>
          </div>
        ) : (
          detections.map((detection, idx) => (
            <div key={idx} className="detection-card">
              <div className="detection-header">
                <span className="node-name">{detection.node_name}</span>
                <span className="timestamp">{formatTime(detection.timestamp)}</span>
              </div>

              <div className="detection-body">
                <div className="detection-row">
                  <label>RSSI:</label>
                  <span
                    className="rssi-value"
                    style={{ color: getRSSIColor(detection.rssi) }}
                  >
                    {detection.rssi} dBm
                  </span>
                </div>

                <div className="detection-row">
                  <label>Observer:</label>
                  <span>{detection.observer}</span>
                </div>

                {detection.path && detection.path.length > 0 && (
                  <div className="detection-row">
                    <label>Pad:</label>
                    <span className="path">{detection.path.join(' → ')}</span>
                  </div>
                )}

                {detection.h3_cell && (
                  <div className="detection-row">
                    <label>H3 Cel:</label>
                    <code>{detection.h3_cell}</code>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
