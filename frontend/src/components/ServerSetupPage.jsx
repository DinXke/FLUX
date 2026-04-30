import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setServerUrl, apiFetch } from '../auth.js';
import '../styles/ServerSetupPage.css';

export default function ServerSetupPage({ onComplete }) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrlInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleTest = async () => {
    if (!serverUrl.trim()) {
      setError(t('serverSetup.enterUrl') || 'Please enter a server URL');
      return;
    }

    setTesting(true);
    setError('');
    setSuccess(false);

    try {
      const testUrl = serverUrl.replace(/\/$/, '');
      const res = await fetch(`${testUrl}/api/status`, { method: 'GET' });
      if (res.ok) {
        setServerUrl(testUrl);
        setSuccess(true);
        setTimeout(() => {
          if (onComplete) onComplete();
        }, 1000);
      } else {
        setError(t('serverSetup.connectionFailed') || 'Connection failed');
      }
    } catch (e) {
      setError(t('serverSetup.connectionError') || `Error: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleTest();
  };

  return (
    <div className="server-setup-container">
      <div className="server-setup-card">
        <div className="server-setup-header">
          <span className="server-setup-logo">🔋</span>
          <h1>{t('serverSetup.title') || 'FLUX Server Configuration'}</h1>
        </div>

        <p className="server-setup-description">
          {t('serverSetup.description') || 'Enter your FLUX server URL to connect (e.g., http://192.168.1.100:5000)'}
        </p>

        <div className="server-setup-form">
          <input
            type="text"
            className="server-setup-input"
            placeholder={t('serverSetup.placeholder') || 'http://192.168.1.100:5000'}
            value={serverUrl}
            onChange={(e) => setServerUrlInput(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={testing}
          />

          {error && <div className="server-setup-error">{error}</div>}
          {success && <div className="server-setup-success">{t('serverSetup.success') || 'Connection successful!'}</div>}

          <button
            className="server-setup-button"
            onClick={handleTest}
            disabled={testing || !serverUrl.trim()}
          >
            {testing ? (t('serverSetup.testing') || 'Testing...') : (t('serverSetup.testConnection') || 'Test Connection')}
          </button>
        </div>
      </div>
    </div>
  );
}
