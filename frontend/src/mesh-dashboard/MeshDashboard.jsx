import React, { useState, useEffect, useCallback } from 'react';
import DetectionFeed from './components/DetectionFeed';
import RepeaterManager from './components/RepeaterManager';
import NotificationSetup from './components/NotificationSetup';
import useSSE from './hooks/useSSE';
import { generateMockDetection, MOCK_REPEATERS } from './services/mockData';
import './styles/MeshDashboard.css';

export default function MeshDashboard() {
  const [detections, setDetections] = useState([]);
  const [repeaters, setRepeaters] = useState(MOCK_REPEATERS);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [apiUrl] = useState(process.env.REACT_APP_API_URL || 'http://localhost:7842');

  const { isConnected, error: sseError } = useSSE(
    `${apiUrl}/api/stream`,
    (detection) => {
      setDetections((prev) => [detection, ...prev].slice(0, 10));
      if (notificationsEnabled && Notification.permission === 'granted') {
        new Notification(`🔔 Detectie: ${detection.node_name}`, {
          body: `RSSI: ${detection.rssi}dBm | ${detection.observer}`,
          icon: '/mesh-icon.png',
        });
      }
    }
  );

  const addRepeater = useCallback(async (name, pubkeyPrefix) => {
    try {
      const response = await fetch(`${apiUrl}/api/repeaters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pubkey_prefix: pubkeyPrefix }),
      });
      if (response.ok) {
        const newRepeater = await response.json();
        setRepeaters((prev) => [...prev, newRepeater]);
      }
    } catch (err) {
      console.error('Error adding repeater:', err);
    }
  }, [apiUrl]);

  const removeRepeater = useCallback(async (id) => {
    try {
      await fetch(`${apiUrl}/api/repeaters/${id}`, { method: 'DELETE' });
      setRepeaters((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Error removing repeater:', err);
    }
  }, [apiUrl]);

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      alert('Browser ondersteunt meldingen niet');
      return;
    }
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(true);
      return;
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotificationsEnabled(true);
      }
    }
  };

  return (
    <div className="mesh-dashboard">
      <header className="mesh-header">
        <h1>🗺️ Mesh Detectie Dashboard</h1>
        <div className="status-bar">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Live' : '⊗ Offline'}
          </span>
          {sseError && <span className="error-text">Fout: {sseError}</span>}
        </div>
      </header>

      <div className="dashboard-layout">
        <main className="dashboard-main">
          <DetectionFeed detections={detections} />
        </main>

        <aside className="dashboard-sidebar">
          <NotificationSetup
            enabled={notificationsEnabled}
            onRequest={requestNotifications}
          />
          <RepeaterManager
            repeaters={repeaters}
            onAdd={addRepeater}
            onRemove={removeRepeater}
          />
        </aside>
      </div>
    </div>
  );
}
