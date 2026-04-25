import { useState, useEffect, useRef } from "react";

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

function EntityPicker({ value, onChange, entities, placeholder }) {
  const [search, setSearch] = useState(value);
  const [open,   setOpen]   = useState(false);
  const ref = useRef(null);

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = entities.filter((e) => {
    const q = search.toLowerCase();
    return e.entity_id.toLowerCase().includes(q) || (e.friendly_name || "").toLowerCase().includes(q);
  });

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", maxWidth: 460 }}>
      <input
        className="form-input" style={{ width: "100%" }}
        placeholder={placeholder || "Zoek entiteit…"}
        value={search}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); onChange(""); }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", zIndex: 100, top: "100%", left: 0, right: 0,
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6,
          maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px #0008",
        }}>
          {filtered.slice(0, 60).map((e) => (
            <div key={e.entity_id}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13,
                borderBottom: "1px solid var(--border)" }}
              onMouseDown={() => { onChange(e.entity_id); setSearch(e.entity_id); setOpen(false); }}>
              <div style={{ fontWeight: 500 }}>{e.friendly_name || e.entity_id}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{e.entity_id}</div>
            </div>
          ))}
        </div>
      )}
      {value && (
        <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>✓ {value}</div>
      )}
    </div>
  );
}

// "entiteit" | "service" | "modbus"
function ModeSelector({ mode, onChange }) {
  const options = [
    { value: "entiteit", label: "Entiteit" },
    { value: "service",  label: "Service" },
    { value: "modbus",   label: "Modbus TCP/IP" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 8,
      padding: 3, border: "1px solid var(--border)" }}>
      {options.map((o) => (
        <button key={o.value} type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1, padding: "5px 10px", borderRadius: 6, border: "none",
            fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all .15s",
            background: mode === o.value ? "var(--accent, #C17A3A)" : "transparent",
            color: mode === o.value ? "#fff" : "var(--text-muted)",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function PvLimiterSettings() {
  const [enabled,       setEnabled]       = useState(false);
  const [mode,          setMode]          = useState("entiteit"); // "entiteit" | "service" | "modbus"
  // Entity mode (number.*)
  const [entity,        setEntity]        = useState("");
  // Service mode
  const [service,       setService]       = useState("");
  const [paramKey,      setParamKey]      = useState("entity_id");
  const [paramVal,      setParamVal]      = useState("");
  const [svcEntity,     setSvcEntity]     = useState("");
  // Modbus TCP/IP mode
  const [modbusHost,    setModbusHost]    = useState("");
  const [modbusPort,    setModbusPort]    = useState(502);
  const [modbusUnitId,  setModbusUnitId]  = useState(3);
  const [modbusReg,     setModbusReg]     = useState(40236);
  const [modbusValMode, setModbusValMode] = useState("W");
  // Shared
  const [minW,            setMinW]            = useState(0);
  const [maxW,            setMaxW]            = useState(4000);
  const [thresholdCt,     setThresholdCt]     = useState(0);
  const [marginW,         setMarginW]         = useState(200);
  const [manualOverride,  setManualOverride]  = useState(false);
  const [manualW,         setManualW]         = useState(2000);
  const [haEntities,    setHaEntities]    = useState([]);
  const [saving,        setSaving]        = useState(false);
  const [success,       setSuccess]       = useState(false);
  const [error,         setError]         = useState(null);

  const numberEntityRef = useRef(null);
  const [numSearch,     setNumSearch]     = useState("");
  const [numOpen,       setNumOpen]       = useState(false);

  useEffect(() => {
    const close = (e) => { if (numberEntityRef.current && !numberEntityRef.current.contains(e.target)) setNumOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    fetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.pv_limiter_enabled ?? false);
        const useModbus  = d.pv_limiter_use_modbus  ?? false;
        const useService = d.pv_limiter_use_service ?? false;
        setMode(useModbus ? "modbus" : useService ? "service" : "entiteit");
        setEntity(d.pv_limiter_entity ?? "");
        setNumSearch(d.pv_limiter_entity ?? "");
        setService(d.pv_limiter_service ?? "");
        setParamKey(d.pv_limiter_service_param_key ?? "entity_id");
        const pval = d.pv_limiter_service_param ?? "";
        setParamVal(pval);
        if ((d.pv_limiter_service_param_key ?? "entity_id") === "entity_id") setSvcEntity(pval);
        setModbusHost(d.pv_limiter_modbus_host ?? "");
        setModbusPort(d.pv_limiter_modbus_port ?? 502);
        setModbusUnitId(d.pv_limiter_modbus_unit_id ?? 3);
        setModbusReg(d.pv_limiter_modbus_register ?? 40236);
        setModbusValMode(d.pv_limiter_modbus_value_mode ?? "W");
        setMinW(d.pv_limiter_min_w ?? 0);
        setMaxW(d.pv_limiter_max_w ?? 4000);
        setThresholdCt(d.pv_limiter_threshold_ct ?? 0);
        setMarginW(d.pv_limiter_margin_w ?? 200);
        setManualOverride(d.pv_limiter_manual_override ?? false);
        setManualW(d.pv_limiter_manual_w ?? 2000);
      })
      .catch(() => {});
    fetch("api/ha/entities")
      .then((r) => r.json())
      .then((d) => setHaEntities(d.entities ?? []))
      .catch(() => {});
  }, []);

  const numberEntities = haEntities.filter((e) =>
    e.entity_id.startsWith("number.") ||
    e.entity_id.startsWith("input_number.") ||
    e.entity_id.startsWith("sensor.")
  );
  const filteredNum = numberEntities.filter((e) => {
    const q = numSearch.toLowerCase();
    return e.entity_id.toLowerCase().includes(q) || (e.friendly_name || "").toLowerCase().includes(q);
  });

  const handleParamKeyChange = (k) => {
    setParamKey(k);
    if (k === "entity_id") { setParamVal(svcEntity); }
  };

  const handleSvcEntityChange = (eid) => {
    setSvcEntity(eid);
    if (paramKey === "entity_id") setParamVal(eid);
  };

  const previewData = { value: "‹W›" };
  if (paramKey && paramVal) previewData[paramKey] = paramVal;

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/strategy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pv_limiter_enabled:           enabled,
          pv_limiter_use_service:       mode === "service",
          pv_limiter_use_modbus:        mode === "modbus",
          pv_limiter_entity:            entity,
          pv_limiter_service:           service,
          pv_limiter_service_param_key: paramKey,
          pv_limiter_service_param:     paramVal,
          pv_limiter_modbus_host:       modbusHost,
          pv_limiter_modbus_port:       Number(modbusPort),
          pv_limiter_modbus_unit_id:    Number(modbusUnitId),
          pv_limiter_modbus_register:   Number(modbusReg),
          pv_limiter_modbus_value_mode: modbusValMode,
          pv_limiter_min_w:             Number(minW),
          pv_limiter_max_w:             Number(maxW),
          pv_limiter_threshold_ct:      Number(thresholdCt),
          pv_limiter_margin_w:          Number(marginW),
          pv_limiter_manual_override:   manualOverride,
          pv_limiter_manual_w:          Number(manualW),
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

      {/* Enable */}
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

      {/* Method selector */}
      <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="settings-row-label">Aanstuurmethode</div>
          <div className="settings-row-desc">
            <strong>Entiteit</strong>: stuurt via <code>number.set_value</code> in HA.&nbsp;
            <strong>Service</strong>: aangepaste HA-service (bijv. <code>pysmaplus.set_value</code>).&nbsp;
            <strong>Modbus TCP/IP</strong>: directe Modbus verbinding naar de omvormer (bypass HA).
          </div>
        </div>
        <ModeSelector mode={mode} onChange={setMode} />
      </div>

      {/* ── Entity mode ── */}
      {mode === "entiteit" && (
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <div>
            <div className="settings-row-label">HA entiteit</div>
            <div className="settings-row-desc">
              Kies een <code>number.*</code>, <code>input_number.*</code> of <code>sensor.*</code> entiteit.
            </div>
          </div>
          <div ref={numberEntityRef} style={{ position: "relative", width: "100%", maxWidth: 460 }}>
            <input className="form-input" style={{ width: "100%" }}
              placeholder="Zoek entiteit…"
              value={numSearch}
              onFocus={() => setNumOpen(true)}
              onChange={(e) => { setNumSearch(e.target.value); setNumOpen(true); setEntity(""); }}
            />
            {numOpen && filteredNum.length > 0 && (
              <div style={{
                position: "absolute", zIndex: 100, top: "100%", left: 0, right: 0,
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6,
                maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px #0008",
              }}>
                {filteredNum.slice(0, 50).map((e) => (
                  <div key={e.entity_id}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13,
                      borderBottom: "1px solid var(--border)" }}
                    onMouseDown={() => { setEntity(e.entity_id); setNumSearch(e.entity_id); setNumOpen(false); }}>
                    <div style={{ fontWeight: 500 }}>{e.friendly_name || e.entity_id}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{e.entity_id}</div>
                  </div>
                ))}
              </div>
            )}
            {entity && <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>✓ {entity}</div>}
          </div>
        </div>
      )}

      {/* ── Service mode ── */}
      {mode === "service" && (
        <>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div>
              <div className="settings-row-label">HA service</div>
              <div className="settings-row-desc">
                In <code>domein.service</code> formaat, bijv. <code>pysmaplus.set_value</code>
              </div>
            </div>
            <input className="form-input" style={{ maxWidth: 460, width: "100%" }}
              placeholder="pysmaplus.set_value"
              value={service} onChange={(e) => setService(e.target.value)} />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Extra veld in data</div>
              <div className="settings-row-desc">
                Wordt naast <code>value</code> meegestuurd.
                Gebruik <code>entity_id</code> voor pysmaplus, <code>parameter</code> voor SMA Devices Plus.
              </div>
            </div>
            <input className="form-input" style={{ width: 140 }}
              placeholder="entity_id"
              value={paramKey} onChange={(e) => handleParamKeyChange(e.target.value)} />
          </div>

          {paramKey === "entity_id" ? (
            <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <div>
                <div className="settings-row-label">Entiteit</div>
                <div className="settings-row-desc">Kies de sensor/entiteit die de vermogensinstelling bijhoudt.</div>
              </div>
              <EntityPicker value={svcEntity} onChange={handleSvcEntityChange}
                entities={haEntities} placeholder="Zoek sensor.* of number.* entiteit…" />
            </div>
          ) : (
            <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <div>
                <div className="settings-row-label">Waarde voor <code>{paramKey || "sleutel"}</code></div>
                <div className="settings-row-desc">Bijv. <code>Active Power Limitation</code> voor SMA Devices Plus.</div>
              </div>
              <input className="form-input" style={{ maxWidth: 460, width: "100%" }}
                placeholder="Active Power Limitation"
                value={paramVal} onChange={(e) => setParamVal(e.target.value)} />
            </div>
          )}

          <div style={{ margin: "0 20px 12px", padding: "10px 14px",
            background: "#0a0f1a", borderRadius: 6, fontSize: 11,
            fontFamily: "monospace", color: "#94a3b8", lineHeight: 1.8 }}>
            <div style={{ color: "#64748b", marginBottom: 2 }}>Voorbeeld aanroep:</div>
            <div>service: <span style={{ color: "#7dd3fc" }}>{service || "…"}</span></div>
            <div>data:</div>
            <div>&nbsp;&nbsp;<span style={{ color: "#86efac" }}>value</span>: <span style={{ color: "#fcd34d" }}>1500</span></div>
            {paramKey && paramVal && (
              <div>&nbsp;&nbsp;<span style={{ color: "#86efac" }}>{paramKey}</span>: <span style={{ color: "#fcd34d" }}>"{paramVal}"</span></div>
            )}
          </div>
        </>
      )}

      {/* ── Modbus TCP/IP mode ── */}
      {mode === "modbus" && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">IP-adres omvormer</div>
              <div className="settings-row-desc">Bijv. <code>192.168.1.50</code> (SMA Sunny Boy op het LAN)</div>
            </div>
            <input className="form-input" style={{ width: 180 }}
              placeholder="192.168.1.50"
              value={modbusHost} onChange={(e) => setModbusHost(e.target.value)} />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Modbus port</div>
              <div className="settings-row-desc">Standaard <code>502</code></div>
            </div>
            <input className="form-input" type="number" style={{ width: 90 }}
              value={modbusPort} onChange={(e) => setModbusPort(e.target.value)} />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Unit ID</div>
              <div className="settings-row-desc">SMA Sunny Boy standaard = <code>3</code></div>
            </div>
            <input className="form-input" type="number" style={{ width: 90 }}
              value={modbusUnitId} onChange={(e) => setModbusUnitId(e.target.value)} />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Register (1-gebaseerd)</div>
              <div className="settings-row-desc">
                SMA WMaxLimPct = <code>40236</code>. Gebruik het adres zoals vermeld in de
                SMA Modbus documentatie (1-gebaseerd).
              </div>
            </div>
            <input className="form-input" type="number" style={{ width: 90 }}
              value={modbusReg} onChange={(e) => setModbusReg(e.target.value)} />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Waarde-modus</div>
              <div className="settings-row-desc">
                <strong>W</strong>: schrijf absolute watts (bijv. 2000).<br />
                <strong>%</strong>: schrijf percentage 0–100 van <em>Max PV-vermogen</em>.
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 8,
              padding: 3, border: "1px solid var(--border)" }}>
              {["W", "pct"].map((v) => (
                <button key={v} type="button" onClick={() => setModbusValMode(v)}
                  style={{
                    padding: "4px 14px", borderRadius: 6, border: "none", fontSize: 12,
                    fontWeight: 500, cursor: "pointer", transition: "all .15s",
                    background: modbusValMode === v ? "var(--accent, #C17A3A)" : "transparent",
                    color: modbusValMode === v ? "#fff" : "var(--text-muted)",
                  }}>
                  {v === "W" ? "Watt (W)" : "Procent (%)"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ margin: "0 20px 12px", padding: "10px 14px",
            background: "#0a0f1a", borderRadius: 6, fontSize: 11,
            fontFamily: "monospace", color: "#94a3b8", lineHeight: 1.8 }}>
            <div style={{ color: "#64748b", marginBottom: 2 }}>Modbus schrijf-opdracht:</div>
            <div>host: <span style={{ color: "#7dd3fc" }}>{modbusHost || "‹ip›"}</span>:{modbusPort}</div>
            <div>unit: <span style={{ color: "#fcd34d" }}>{modbusUnitId}</span></div>
            <div>register: <span style={{ color: "#fcd34d" }}>{modbusReg}</span> (addr {Math.max(0, Number(modbusReg) - 40001)})</div>
            <div>value: <span style={{ color: "#86efac" }}>
              {modbusValMode === "pct"
                ? `‹target_W / ${maxW}W × 100›`
                : "‹target_W›"}
            </span></div>
          </div>
        </>
      )}

      {/* Manual override */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Manuele overschrijving</div>
          <div className="settings-row-desc">
            Negeer de prijs-logica en stel de limiet handmatig in op een vaste waarde.
          </div>
        </div>
        <Toggle on={manualOverride} onChange={setManualOverride} />
      </div>

      {manualOverride && (
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div className="settings-row-label">Manuele limiet (W)</div>
            <div className="settings-row-desc">
              Actief vermogen: <strong>{Number(manualW)} W</strong> van {maxW} W max
            </div>
          </div>
          <div style={{ width: "100%", maxWidth: 460, display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min={0}
              max={Number(maxW) || 4000}
              step={50}
              value={manualW}
              onChange={(e) => setManualW(e.target.value)}
              style={{ flex: 1, accentColor: "var(--accent, #C17A3A)" }}
            />
            <input className="form-input" type="number" style={{ width: 90 }}
              min={0} max={Number(maxW) || 4000}
              value={manualW} onChange={(e) => setManualW(e.target.value)} />
          </div>
        </div>
      )}

      {/* Min W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Minimaal PV-vermogen (W)</div>
          <div className="settings-row-desc">
            Limiet bij negatieve/goedkope prijzen. <strong>0</strong> = productie volledig stoppen.
          </div>
        </div>
        <input className="form-input" type="number" style={{ width: 100 }}
          value={minW} onChange={(e) => setMinW(e.target.value)} />
      </div>

      {/* Max W */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Maximaal PV-vermogen (W)</div>
          <div className="settings-row-desc">Normaal vermogen als de prijs boven de drempel ligt.</div>
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
          <div className="settings-row-desc">Buffer bovenop verbruik + laden (standaard 200 W).</div>
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
