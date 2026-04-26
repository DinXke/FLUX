import { apiFetch } from "../auth.js";
import { useState, useEffect } from "react";

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

export default function RollingCapSettings() {
  const [enabled,       setEnabled]       = useState(false);
  const [maxNetW,       setMaxNetW]       = useState(8000);
  const [netWindowM,    setNetWindowM]    = useState(10);
  const [deviceWindowM, setDeviceWindowM] = useState(5);
  const [status,        setStatus]        = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [success,       setSuccess]       = useState(false);
  const [error,         setError]         = useState(null);

  useEffect(() => {
    apiFetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.rolling_cap_enabled ?? false);
        setMaxNetW(d.rolling_cap_max_net_w ?? 8000);
        setNetWindowM(d.rolling_cap_net_window_m ?? 10);
        setDeviceWindowM(d.rolling_cap_device_window_m ?? 5);
      })
      .catch(() => {});
    apiFetch("api/rolling-cap/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await apiFetch("api/strategy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rolling_cap_enabled:         enabled,
          rolling_cap_max_net_w:       Number(maxNetW),
          rolling_cap_net_window_m:    Number(netWindowM),
          rolling_cap_device_window_m: Number(deviceWindowM),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");
      setSuccess(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const avgPct = status?.avg_net_w != null && status?.max_net_w
    ? Math.min(100, Math.round((status.avg_net_w / status.max_net_w) * 100))
    : null;

  const avgColor = avgPct == null
    ? "var(--text)"
    : avgPct >= 100 ? "var(--red)"
    : avgPct >= 85  ? "#f59e0b"
    : "var(--green)";

  return (
    <div className="settings-section">
      <div className="settings-section-title">🔄 Zwevend netsaldo-plafond (PV-first)</div>

      {/* Enable */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Plafond inschakelen</div>
          <div className="settings-row-desc">
            Bewaakt het zwevend gemiddeld netsaldo en stuurt bij via (1) PV-limiter en
            (2) batterijlaadvermogen. Werkt onafhankelijk van strategie-modus.
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} />
      </div>

      {/* Max net W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Max zwevend netsaldo (W)</div>
          <div className="settings-row-desc">
            Maximaal toegestaan zwevend gemiddeld netverbruik (import).
            Bij overschrijding wordt eerst de PV beperkt, dan het batterijladen.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 110 }}
          min={500} max={30000} step={100}
          value={maxNetW} onChange={(e) => setMaxNetW(e.target.value)} />
      </div>

      {/* Net window */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Venster netsaldo (min)</div>
          <div className="settings-row-desc">
            Tijdvenster voor het zwevend gemiddelde van het netsaldo. Standaard: 10 min.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 80 }}
          min={1} max={60} step={1}
          value={netWindowM} onChange={(e) => setNetWindowM(e.target.value)} />
      </div>

      {/* Device window */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Venster apparaten (min)</div>
          <div className="settings-row-desc">
            Tijdvenster voor het zwevend gemiddelde van PV-productie en batterijladen. Standaard: 5 min.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 80 }}
          min={1} max={60} step={1}
          value={deviceWindowM} onChange={(e) => setDeviceWindowM(e.target.value)} />
      </div>

      {/* Live status */}
      {status && (
        <div style={{ margin: "0 20px 16px", padding: "12px 16px",
          background: "#0a0f1a", borderRadius: 8, fontSize: 12 }}>
          <div style={{ color: "#64748b", marginBottom: 8, fontWeight: 600, fontSize: 11,
            textTransform: "uppercase", letterSpacing: "0.05em" }}>Live status</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            {status.avg_net_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>Zwevend gemiddeld netsaldo</span>
                <span style={{ color: avgColor, fontWeight: 600 }}>
                  {status.avg_net_w.toFixed(0)} W
                  {avgPct != null && (
                    <span style={{ color: "#64748b", fontWeight: 400 }}> ({avgPct}% van max)</span>
                  )}
                </span>
                <span style={{ color: "#94a3b8" }}>Meetpunten in venster</span>
                <span style={{ color: "var(--text)" }}>{status.sample_count}</span>
              </>
            )}
            {status.avg_net_w == null && (
              <span style={{ color: "#64748b", gridColumn: "1 / -1" }}>
                Nog geen meetpunten – wacht tot de eerste meting binnenkomt.
              </span>
            )}
            {status.pv_override_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>PV beperkt tot</span>
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>{status.pv_override_w} W</span>
              </>
            )}
            {status.bat_max_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>Batterijladen beperkt tot</span>
                <span style={{ color: "#f59e0b", fontWeight: 600 }}>{status.bat_max_w} W</span>
              </>
            )}
            {status.pv_override_w == null && status.bat_max_w == null && status.avg_net_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>Bijsturing actief</span>
                <span style={{ color: "var(--green)", fontWeight: 600 }}>Nee – binnen plafond</span>
              </>
            )}
          </div>
          <div style={{ marginTop: 10, color: "#64748b", fontSize: 11 }}>
            Bijsturings-volgorde: (1) PV-limiter verlagen → (2) batterijlaadvermogen verlagen
          </div>
        </div>
      )}

      {error   && <div className="form-error" style={{ margin: "0 20px 8px" }}>{error}</div>}
      {success && <div style={{ fontSize: 12, color: "var(--green)", margin: "0 20px 8px" }}>✓ Opgeslagen</div>}
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
    </div>
  );
}
