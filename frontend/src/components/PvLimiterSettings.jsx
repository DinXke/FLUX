import { useState, useEffect, useRef } from "react";

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

export default function PvLimiterSettings() {
  const [enabled,        setEnabled]        = useState(false);
  const [useService,     setUseService]     = useState(false);
  // Entity mode
  const [entity,         setEntity]         = useState("");
  const [entitySearch,   setEntitySearch]   = useState("");
  const [entityOpen,     setEntityOpen]     = useState(false);
  const [haEntities,     setHaEntities]     = useState([]);
  // Service mode
  const [service,        setService]        = useState("");
  const [serviceParam,   setServiceParam]   = useState("");
  // Shared
  const [maxW,           setMaxW]           = useState(4000);
  const [thresholdCt,    setThresholdCt]    = useState(0);
  const [marginW,        setMarginW]        = useState(200);
  const [saving,         setSaving]         = useState(false);
  const [success,        setSuccess]        = useState(false);
  const [error,          setError]          = useState(null);

  const entityRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (entityRef.current && !entityRef.current.contains(e.target)) setEntityOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    fetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.pv_limiter_enabled ?? false);
        setUseService(d.pv_limiter_use_service ?? false);
        setEntity(d.pv_limiter_entity ?? "");
        setEntitySearch(d.pv_limiter_entity ?? "");
        setService(d.pv_limiter_service ?? "");
        setServiceParam(d.pv_limiter_service_param ?? "");
        setMaxW(d.pv_limiter_max_w ?? 4000);
        setThresholdCt(d.pv_limiter_threshold_ct ?? 0);
        setMarginW(d.pv_limiter_margin_w ?? 200);
      })
      .catch(() => {});
    fetch("api/ha/entities")
      .then((r) => r.json())
      .then((d) => setHaEntities(d.entities ?? []))
      .catch(() => {});
  }, []);

  const numberEntities = haEntities.filter((e) =>
    e.entity_id.startsWith("number.") || e.entity_id.startsWith("input_number.")
  );
  const filteredEntities = numberEntities.filter((e) => {
    const q = entitySearch.toLowerCase();
    return e.entity_id.toLowerCase().includes(q) || (e.friendly_name || "").toLowerCase().includes(q);
  });

  const selectEntity = (e) => {
    setEntity(e.entity_id);
    setEntitySearch(e.friendly_name || e.entity_id);
    setEntityOpen(false);
  };

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/strategy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pv_limiter_enabled:        enabled,
          pv_limiter_use_service:    useService,
          pv_limiter_entity:         entity,
          pv_limiter_service:        service,
          pv_limiter_service_param:  serviceParam,
          pv_limiter_max_w:          Number(maxW),
          pv_limiter_threshold_ct:   Number(thresholdCt),
          pv_limiter_margin_w:       Number(marginW),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");
      setSuccess(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">☀️ PV-limiter (omvormer)</div>

      {/* Enable toggle */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">PV-limiter inschakelen</div>
          <div className="settings-row-desc">
            Beperkt het PV-vermogen bij negatieve/goedkope stroomprijzen zodat
            er niets teruggeleverd wordt naar het net.
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} />
      </div>

      {/* Method toggle */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Aanstuurmethode</div>
          <div className="settings-row-desc">
            Entiteit: standaard <code>number.*</code> via <code>number.set_value</code>.<br />
            Service: aangepaste HA service (bijv. SMA Devices Plus).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: useService ? "var(--text-muted)" : "var(--text)" }}>Entiteit</span>
          <Toggle on={useService} onChange={setUseService} />
          <span style={{ fontSize: 13, color: useService ? "var(--text)" : "var(--text-muted)" }}>Service</span>
        </div>
      </div>

      {/* Entity picker (entity mode) */}
      {!useService && (
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <div>
            <div className="settings-row-label">HA entiteit</div>
            <div className="settings-row-desc">
              Kies de <code>number.*</code> entiteit van je omvormer. De app roept
              <code>number.set_value</code> aan met het berekende vermogen.
            </div>
          </div>
          <div ref={entityRef} style={{ position: "relative", width: "100%", maxWidth: 420 }}>
            <input
              className="form-input"
              style={{ width: "100%" }}
              placeholder="Zoek entiteit…"
              value={entitySearch}
              onFocus={() => setEntityOpen(true)}
              onChange={(e) => { setEntitySearch(e.target.value); setEntityOpen(true); setEntity(""); }}
            />
            {entityOpen && filteredEntities.length > 0 && (
              <div style={{
                position: "absolute", zIndex: 100, top: "100%", left: 0, right: 0,
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6,
                maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px #0008",
              }}>
                {filteredEntities.slice(0, 50).map((e) => (
                  <div key={e.entity_id}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13,
                      borderBottom: "1px solid var(--border)" }}
                    onMouseDown={() => selectEntity(e)}>
                    <div style={{ fontWeight: 500 }}>{e.friendly_name || e.entity_id}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{e.entity_id}</div>
                  </div>
                ))}
              </div>
            )}
            {entity && (
              <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>✓ {entity}</div>
            )}
          </div>
        </div>
      )}

      {/* Custom service (service mode) */}
      {useService && (
        <>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div>
              <div className="settings-row-label">HA service</div>
              <div className="settings-row-desc">
                Service in <code>domein.service</code> formaat, bijv.{" "}
                <code>sma_devices_plus.set_parameter</code>
              </div>
            </div>
            <input className="form-input" style={{ maxWidth: 420, width: "100%" }}
              placeholder="sma_devices_plus.set_parameter"
              value={service} onChange={(e) => setService(e.target.value)} />
          </div>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div>
              <div className="settings-row-label">Parameter naam</div>
              <div className="settings-row-desc">
                Wordt als <code>"parameter"</code> meegegeven naast <code>"value"</code>.
                Bijv. <code>Active Power Limitation</code>
              </div>
            </div>
            <input className="form-input" style={{ maxWidth: 420, width: "100%" }}
              placeholder="Active Power Limitation"
              value={serviceParam} onChange={(e) => setServiceParam(e.target.value)} />
          </div>
          <div style={{ margin: "0 20px 12px", padding: "10px 14px",
            background: "#0a0f1a", borderRadius: 6, fontSize: 11,
            fontFamily: "monospace", color: "#94a3b8", lineHeight: 1.7 }}>
            <div style={{ color: "#64748b", marginBottom: 4 }}>Voorbeeld aanroep bij 1500 W limiet:</div>
            <div>{`service: ${service || "sma_devices_plus.set_parameter"}`}</div>
            {serviceParam && <div>{`data: { parameter: "${serviceParam}", value: 1500 }`}</div>}
            {!serviceParam && <div>{`data: { value: 1500 }`}</div>}
          </div>
        </>
      )}

      {/* Max W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Maximaal PV-vermogen (W)</div>
          <div className="settings-row-desc">
            Normaal vermogen als de prijs boven de drempel ligt (bijv. 4000 W).
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 100 }}
          value={maxW} onChange={(e) => setMaxW(e.target.value)} />
      </div>

      {/* Threshold */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Prijsdrempel (ct/kWh)</div>
          <div className="settings-row-desc">
            Onder deze prijs wordt de PV gelimiteerd. 0 = alleen bij negatieve prijzen.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 100 }}
          value={thresholdCt} onChange={(e) => setThresholdCt(e.target.value)} />
      </div>

      {/* Margin W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Extra marge (W)</div>
          <div className="settings-row-desc">
            Buffer bovenop verbruik + laden om schommelingen op te vangen (standaard 200 W).
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 100 }}
          value={marginW} onChange={(e) => setMarginW(e.target.value)} />
      </div>

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
