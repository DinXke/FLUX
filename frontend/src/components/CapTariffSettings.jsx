import { useState, useEffect } from "react";

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

export default function CapTariffSettings() {
  const [enabled,    setEnabled]    = useState(false);
  const [maxGridW,   setMaxGridW]   = useState(8000);
  const [status,     setStatus]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [success,    setSuccess]    = useState(false);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    fetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.cap_tariff_enabled ?? false);
        setMaxGridW(d.cap_tariff_max_grid_w ?? 8000);
      })
      .catch(() => {});
    fetch("api/cap-tariff/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/strategy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cap_tariff_enabled:    enabled,
          cap_tariff_max_grid_w: Number(maxGridW),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");
      setSuccess(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const headroomW = status?.live_net_w != null
    ? Math.max(0, (status.max_grid_w ?? maxGridW) - status.live_net_w)
    : null;
  const peakPct = status?.month_peak_w != null
    ? Math.min(100, Math.round((status.month_peak_w / (status.max_grid_w ?? maxGridW)) * 100))
    : null;

  return (
    <div className="settings-section">
      <div className="settings-section-title">⚡ Capaciteitstarief-bescherming (BE)</div>

      {/* Enable */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Bescherming inschakelen</div>
          <div className="settings-row-desc">
            Knijpt grid charge automatisch af als het netsaldo boven de drempel uitkomt.
            Voorkomt dure maandpiek door gelijktijdig laden met EV of warmtepomp.
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} />
      </div>

      {/* Max grid W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Max netsaldo (W)</div>
          <div className="settings-row-desc">
            Maximaal toegestaan netverbruik (import) incl. huis, EV én batterijladen.
            Typisch: 8000 W (230 V × 35 A). De laadstroom wordt proportioneel
            ingekrompen zodat dit plafond niet overschreden wordt.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 110 }}
          min={1000} max={30000} step={100}
          value={maxGridW} onChange={(e) => setMaxGridW(e.target.value)} />
      </div>

      {/* Live status */}
      {status && (
        <div style={{ margin: "0 20px 16px", padding: "12px 16px",
          background: "#0a0f1a", borderRadius: 8, fontSize: 12 }}>
          <div style={{ color: "#64748b", marginBottom: 8, fontWeight: 600, fontSize: 11,
            textTransform: "uppercase", letterSpacing: "0.05em" }}>Live status</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            {status.live_net_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>Actueel netsaldo</span>
                <span style={{
                  color: status.live_net_w >= (status.max_grid_w ?? maxGridW)
                    ? "var(--red)" : status.live_net_w >= (status.max_grid_w ?? maxGridW) * 0.85
                    ? "#f59e0b" : "var(--green)",
                  fontWeight: 600,
                }}>{status.live_net_w.toFixed(0)} W</span>
                <span style={{ color: "#94a3b8" }}>Beschikbare ruimte</span>
                <span style={{ color: headroomW === 0 ? "var(--red)" : "var(--text)", fontWeight: 600 }}>
                  {headroomW?.toFixed(0)} W
                </span>
              </>
            )}
            {status.month_peak_w != null && (
              <>
                <span style={{ color: "#94a3b8" }}>Maandpiek (deze maand)</span>
                <span style={{ fontWeight: 600, color: peakPct >= 90 ? "var(--red)" : "var(--text)" }}>
                  {status.month_peak_w.toFixed(0)} W
                  {peakPct != null && (
                    <span style={{ color: "#64748b", fontWeight: 400 }}> ({peakPct}% van max)</span>
                  )}
                </span>
              </>
            )}
          </div>
          {/* Peak history */}
          {status.peak_history && Object.keys(status.peak_history).length > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px solid #1e293b", paddingTop: 10 }}>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6 }}>Piekgeschiedenis</div>
              {Object.entries(status.peak_history).sort().map(([m, w]) => (
                <div key={m} style={{ display: "flex", gap: 16, color: "#94a3b8", fontSize: 11 }}>
                  <span style={{ fontFamily: "monospace", minWidth: 60 }}>{m}</span>
                  <span>{w} W</span>
                </div>
              ))}
            </div>
          )}
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
