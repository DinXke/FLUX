import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getServerUrl, setServerUrl, apiFetch } from '../auth.js';

export default function ServerUrlSettings() {
  const { t } = useTranslation();
  const [serverUrl, setServerUrlInput] = useState(getServerUrl());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  const isNativeApp = typeof window !== 'undefined' && window.Capacitor?.isNative;

  // Only show for Capacitor/native app
  if (!isNativeApp) {
    return (
      <div className="settings-section">
        <div className="settings-row">
          <p style={{ color: '#718096', fontSize: '14px' }}>
            {t('serverUrl.onlyCapacitor') || 'Server URL configuration is only available in the native app.'}
          </p>
        </div>
      </div>
    );
  }

  const handleTest = async () => {
    if (!serverUrl.trim()) {
      setError(t('serverUrl.enterUrl') || 'Please enter a server URL');
      return;
    }

    setTesting(true);
    setError('');
    setTestResult(null);

    try {
      const testUrl = serverUrl.replace(/\/$/, '');
      const res = await fetch(`${testUrl}/api/health`, { method: 'GET' });
      if (res.ok) {
        setTestResult('success');
        setError('');
      } else {
        setTestResult('failed');
        setError(t('serverUrl.connectionFailed') || 'Connection failed');
      }
    } catch (e) {
      setTestResult('failed');
      setError(t('serverUrl.connectionError') || `Error: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!serverUrl.trim()) {
      setError(t('serverUrl.enterUrl') || 'Please enter a server URL');
      return;
    }
    setServerUrl(serverUrl);
    setTestResult('saved');
    setTimeout(() => setTestResult(null), 3000);
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">🌐 {t('serverUrl.title') || 'Server URL'}</div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('serverUrl.label') || 'FLUX Server Address'}</div>
            <div className="settings-row-desc">
              {t('serverUrl.description') || 'Enter the URL of your FLUX server (e.g., http://192.168.1.100:5000)'}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px', marginBottom: '12px' }}>
          <input
            type="text"
            className="settings-input"
            placeholder={t('serverUrl.placeholder') || 'http://192.168.1.100:5000'}
            value={serverUrl}
            onChange={(e) => setServerUrlInput(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              backgroundColor: 'rgba(15, 27, 45, 0.5)',
              color: '#fff',
              fontSize: '14px',
            }}
          />
        </div>

        {error && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            background: 'rgba(245, 101, 101, 0.1)',
            border: '1px solid #f56565',
            borderRadius: '6px',
            color: '#fc8181',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {testResult === 'success' && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            background: 'rgba(72, 187, 120, 0.1)',
            border: '1px solid #48bb78',
            borderRadius: '6px',
            color: '#9ae6b4',
            fontSize: '13px',
          }}>
            ✓ {t('serverUrl.success') || 'Connection successful!'}
          </div>
        )}

        {testResult === 'saved' && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            background: 'rgba(72, 187, 120, 0.1)',
            border: '1px solid #48bb78',
            borderRadius: '6px',
            color: '#9ae6b4',
            fontSize: '13px',
          }}>
            ✓ {t('serverUrl.saved') || 'URL saved!'}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleTest}
            disabled={testing}
            style={{
              flex: 1,
              padding: '10px',
              background: 'rgba(66, 153, 225, 0.2)',
              border: '1px solid #4299e1',
              borderRadius: '6px',
              color: '#4299e1',
              fontSize: '13px',
              fontWeight: '500',
              cursor: testing ? 'not-allowed' : 'pointer',
              opacity: testing ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => !testing && (e.target.style.background = 'rgba(66, 153, 225, 0.3)')}
            onMouseLeave={(e) => (e.target.style.background = 'rgba(66, 153, 225, 0.2)')}
          >
            {testing ? t('serverUrl.testing') || 'Testing...' : t('serverUrl.testConnection') || 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: '10px',
              background: 'linear-gradient(135deg, #4299e1 0%, #2b6cb0 100%)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => (e.target.style.transform = 'translateY(-2px)')}
            onMouseLeave={(e) => (e.target.style.transform = 'translateY(0)')}
          >
            {t('serverUrl.save') || 'Save'}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('serverUrl.currentLabel') || 'Current URL'}</div>
            <code style={{ color: '#a0aec0', fontSize: '12px', wordBreak: 'break-all' }}>
              {getServerUrl() || t('serverUrl.notSet') || 'Not set'}
            </code>
          </div>
        </div>
      </div>
    </>
  );
}
