import { apiFetch } from "../auth.js";
import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export const FLOW_CFG_KEY = "marstek_flow_cfg";

export function loadFlowCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLOW_CFG_KEY) || "{}");
    const cfg = {};
    for (const [key, val] of Object.entries(raw)) {
      if (Array.isArray(val))               cfg[key] = val;
      else if (val && typeof val === "object") cfg[key] = [val];
    }
    return cfg;
  } catch { return {}; }
}

export function saveFlowCfg(cfg) {
  localStorage.setItem(FLOW_CFG_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new Event("marstek_flow_cfg_changed"));
}

// Called once at app startup. Seeds localStorage from the server copy so
// settings survive an upgrade even when the browser cache was cleared.
export async function bootstrapFlowCfg(apiFetchFn) {
  try {
    const r = await apiFetchFn("/api/flow/cfg");
    if (!r.ok) return;
    const serverCfg = await r.json();
    if (!serverCfg || !Object.keys(serverCfg).length) return;
    // Only restore from server when localStorage is empty (upgrade scenario).
    const local = localStorage.getItem(FLOW_CFG_KEY);
    const localEmpty = !local || local === "{}";
    if (localEmpty) {
      saveFlowCfg(serverCfg);
    }
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Slot + sensor definitions
// ---------------------------------------------------------------------------

const SLOT_DEFS = {
  solar_power: { label: "☀️ Zonne-energie",          unit: "W",  desc: "Positief = producerend. Verbergt solar-node als leeg." },
  net_power:   { label: "⚡ Net vermogen",            unit: "W",  desc: "Positief = importeren van net." },
  house_power: { label: "🏠 Totaal verbruik huis",   unit: "W",  desc: "Totaal huisverbruik (W). Wordt gebruikt voor overproductie-detectie. Laat leeg om te berekenen via zon + net." },
  bat_power:   { label: "🔋 Batterijvermogen",       unit: "W",  desc: "Positief = ontladen. Meerdere opgeteld." },
  bat_soc:     { label: "🔋 Laadniveau (SOC)",       unit: "%",  desc: "Laadstatus %. Meerdere = gemiddelde." },
  ev_power:    { label: "🚗 EV-laadstroom",          unit: "W",  desc: "Positief = EV laden. Verbergt EV-node als leeg." },
  voltage_l1:  { label: "L1 spanning",               unit: "V",  desc: "Fasespanning L1." },
  voltage_l2:  { label: "L2 spanning",               unit: "V",  desc: "Fasespanning L2." },
  voltage_l3:  { label: "L3 spanning",               unit: "V",  desc: "Fasespanning L3." },
};

export const SLOT_ORDER = ["solar_power","net_power","house_power","bat_power","bat_soc","ev_power","voltage_l1","voltage_l2","voltage_l3"];

// Custom nodes configuration
export const DEFAULT_CUSTOM_NODE = {
  id: null,
  name: "Nieuw apparaat",
  icon: "⚙️",
  source: null,
  unit: "W",
};

// Preset device types with icons
export const DEVICE_PRESETS = [
  { label: "Wasmachine",  icon: "🫧" },
  { label: "Droogkast",   icon: "🌀" },
  { label: "Airco",       icon: "❄️" },
  { label: "Vaatwasser",  icon: "🍽️" },
  { label: "Elektrische oven", icon: "🔥" },
  { label: "EV-lader",    icon: "🚗" },
  { label: "Warmtepomp",  icon: "♨️" },
  { label: "Andere",      icon: "🔌" },
];

const ESPHOME_SENSORS = [
  { key: "batPower",  label: "Batterijvermogen", unit: "W"  },
  { key: "acPower",   label: "AC vermogen",      unit: "W",  hint: "Positief = terugleveren → gebruik 'Omkeren' als bron voor net-import" },
  { key: "soc",       label: "Laadniveau (SOC)", unit: "%"  },
  { key: "acVoltage", label: "AC spanning",      unit: "V"  },
  { key: "l1V",       label: "L1 spanning",      unit: "V"  },
  { key: "l2V",       label: "L2 spanning",      unit: "V"  },
  { key: "l3V",       label: "L3 spanning",      unit: "V"  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtVal(value, unit) {
  if (value == null) return "";
  if (unit === "W") return Math.abs(value) >= 1000 ? `${(value/1000).toFixed(2)} kW` : `${Math.round(value)} W`;
  if (unit === "kWh") return `${value.toFixed(3)} kWh`;
  if (unit === "V")   return `${value.toFixed(1)} V`;
  if (unit === "%")   return `${value.toFixed(1)}%`;
  return `${value} ${unit}`;
}

function slotArr(config, key) {
  const v = config[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function isSelected(arr, opt) {
  return arr.some((sc) => sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor);
}

function getInvert(arr, opt) {
  return arr.find((sc) => sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor)?.invert ?? false;
}

// ---------------------------------------------------------------------------
// MultiSelect – searchable dropdown with chips (for HA entities)
// ---------------------------------------------------------------------------

function MultiSelect({ options, selected, onChange, unit, currentValues }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) ||
    o.sensor.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (opt) => {
    if (isSelected(selected, opt)) {
      onChange(selected.filter((sc) => !(sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor)));
    } else {
      onChange([...selected, { source: opt.source, device_id: opt.deviceId, sensor: opt.sensor, invert: false }]);
    }
  };

  const toggleInvert = (opt, val) => {
    onChange(selected.map((sc) =>
      sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor
        ? { ...sc, invert: val } : sc
    ));
  };

  const selectedOpts = selected.map((sc) =>
    options.find((o) => o.source === sc.source && o.deviceId === sc.device_id && o.sensor === sc.sensor)
  ).filter(Boolean);

  return (
    <div className="ms-wrap" ref={ref}>
      {/* Chips + trigger */}
      <div className={`ms-control ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {selectedOpts.length === 0 ? (
          <span className="ms-placeholder">Kies sensor(en)…</span>
        ) : (
          <div className="ms-chips">
            {selectedOpts.map((opt) => {
              const sc  = selected.find((s) => s.source === opt.source && s.device_id === opt.deviceId && s.sensor === opt.sensor);
              const cur = currentValues?.[opt.sensor];
              return (
                <span key={opt.key} className="ms-chip" onClick={(e) => e.stopPropagation()}>
                  <span className="ms-chip-label">{opt.label}</span>
                  {cur != null && <span className="ms-chip-val">{fmtVal(cur, unit)}</span>}
                  <label className="ms-chip-inv" title="Omkeren">
                    <input type="checkbox" checked={sc?.invert ?? false}
                      onChange={(e) => toggleInvert(opt, e.target.checked)} />
                    ⇄
                  </label>
                  <button className="ms-chip-remove" onClick={() => toggle(opt)}>×</button>
                </span>
              );
            })}
          </div>
        )}
        <span className="ms-arrow">{open ? "▲" : "▼"}</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="ms-dropdown">
          <div className="ms-search-wrap">
            <input className="ms-search" autoFocus placeholder="Zoeken…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()} />
          </div>
          {filtered.length === 0 ? (
            <div className="ms-empty">Geen resultaten</div>
          ) : (
            <ul className="ms-list">
              {filtered.map((opt) => {
                const checked = isSelected(selected, opt);
                const cur = currentValues?.[opt.sensor];
                return (
                  <li key={opt.key} className={`ms-option ${checked ? "selected" : ""}`}
                    onClick={() => toggle(opt)}>
                    <span className="ms-check">{checked ? "✓" : ""}</span>
                    <span className="ms-opt-label">{opt.label}</span>
                    <span className="ms-opt-id">{opt.sensor}</span>
                    {cur != null && <span className="ms-opt-val">{fmtVal(cur, unit)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset Picker Modal
// ---------------------------------------------------------------------------

function PresetPickerModal({ onClose, onSelect }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Select Device Type">
        <div className="modal-header">
          <span className="modal-title">Selecteer apparaattype</span>
          <button className="btn-icon btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={{ padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
            {DEVICE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn btn-ghost"
                onClick={() => onSelect(preset)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                  e.currentTarget.style.borderColor = "var(--blue)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <span style={{ fontSize: "32px" }}>{preset.icon}</span>
                <span style={{ fontSize: "12px", fontWeight: "500", textAlign: "center" }}>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// InfluxDB slot definitions (unit must match SLOT_DEFS units for filtering)
const INFLUX_SLOT_META = {
  solar_w: { label: "☀️ Zonnepanelen",        unit: "W" },
  net_w:   { label: "⚡ Net (import/export)", unit: "W" },
  house_w: { label: "🏠 Thuisverbruik",       unit: "W" },
  bat_w:   { label: "🔌 Batterij vermogen",   unit: "W" },
  bat_soc: { label: "🔋 Batterij SOC",        unit: "%" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FlowSourcesSettings({ devices = [], powerMap = {} }) {
  const [config,      setConfig]      = useState(() => loadFlowCfg());
  const [hwData,      setHwData]      = useState(null);
  const [haEntities,  setHaEntities]  = useState([]);
  const [influxSrc,   setInfluxSrc]   = useState(null);
  const [influxLive,  setInfluxLive]  = useState({});
  const [smaSources,  setSmaSources]  = useState([]);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [collapsedSlots, setCollapsedSlots] = useState(() => {
    const collapsed = {};
    for (const slotKey of SLOT_ORDER) {
      collapsed[slotKey] = true; // Default = collapsed
    }
    return collapsed;
  });
  const [collapsedCustom, setCollapsedCustom] = useState(false); // Default = open

  const loadHw = useCallback(async () => {
    try { const r = await apiFetch("/api/homewizard/data"); if (r.ok) setHwData(await r.json()); } catch {}
  }, []);

  const loadHa = useCallback(async () => {
    try {
      const r = await apiFetch("/api/ha/entities");
      if (r.ok) { const d = await r.json(); setHaEntities(d.entities ?? []); }
    } catch {}
  }, []);

  const loadInflux = useCallback(async () => {
    try {
      const [srcR, liveR] = await Promise.all([
        apiFetch("/api/influx/source"),
        apiFetch("/api/influx/live-slots"),
      ]);
      if (srcR.ok)  setInfluxSrc(await srcR.json());
      if (liveR.ok) setInfluxLive(await liveR.json());
    } catch {}
  }, []);

  const loadSma = useCallback(async () => {
    try {
      const r = await apiFetch("/api/sma/source");
      if (r.ok) setSmaSources(await r.json());
    } catch {}
  }, []);

  useEffect(() => { loadHw(); loadHa(); loadInflux(); loadSma(); }, [loadHw, loadHa, loadInflux, loadSma]);

  // ── Build options ─────────────────────────────────────────────────────────
  const esphomeOptions = [];
  for (const device of devices) {
    const pm = powerMap[device.id] ?? {};
    for (const sensor of ESPHOME_SENSORS) {
      esphomeOptions.push({
        key: `esphome::${device.id}::${sensor.key}`,
        source: "esphome", deviceId: device.id, sensor: sensor.key,
        label: `${device.name} — ${sensor.label}`,
        unit: sensor.unit, current: pm[sensor.key] ?? null, hint: sensor.hint ?? "",
      });
    }
  }

  const hwOptions = [];
  for (const dev of hwData?.devices ?? []) {
    for (const [key, meta] of Object.entries(dev.sensors ?? {})) {
      hwOptions.push({
        key: `homewizard::${dev.id}::${key}`,
        source: "homewizard", deviceId: dev.id, sensor: key,
        label: `${dev.name} — ${meta.label}`,
        unit: meta.unit ?? "", current: meta.value ?? null, hint: "",
      });
    }
  }

  const influxOptions = [];
  if (influxSrc?.mappings) {
    for (const [slotKey, meta] of Object.entries(INFLUX_SLOT_META)) {
      const mapping = influxSrc.mappings[slotKey];
      if (!mapping) continue;
      const entries = Array.isArray(mapping) ? mapping : [mapping];
      if (!entries.some((e) => e.field)) continue;
      influxOptions.push({
        key: `influx::influx::${slotKey}`,
        source: "influx", deviceId: "influx", sensor: slotKey,
        label: meta.label, unit: meta.unit,
        current: influxLive[slotKey] ?? null, hint: "",
      });
    }
  }

  const smaOptions = (smaSources ?? []).map((s) => ({
    key: s.key,
    source: s.source,
    deviceId: s.deviceId,
    sensor: s.sensor,
    label: s.label,
    unit: s.unit,
    current: s.current ?? null,
    hint: "",
  }));

  // SMA and HA current values maps for live display
  const smaCurrentValues = {};
  for (const src of smaSources) {
    if (src.current != null) smaCurrentValues[src.sensor] = src.current;
  }

  const haCurrentValues = {};
  for (const e of haEntities) {
    if (e.state != null) haCurrentValues[e.entity_id] = parseFloat(e.state);
  }

  const haOptions = haEntities.map((e) => ({
    key: `homeassistant::ha::${e.entity_id}`,
    source: "homeassistant", deviceId: "ha", sensor: e.entity_id,
    label: e.friendly_name || e.entity_id,
    unit: e.unit, current: e.state != null ? parseFloat(e.state) : null, hint: "",
  }));

  // ── Toggle helpers ────────────────────────────────────────────────────────
  const toggleOption = (slotKey, opt, checked) => {
    setConfig((prev) => {
      const arr = [...slotArr(prev, slotKey)];
      if (checked) {
        arr.push({ source: opt.source, device_id: opt.deviceId, sensor: opt.sensor, invert: false });
      } else {
        const idx = arr.findIndex((sc) => sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor);
        if (idx >= 0) arr.splice(idx, 1);
      }
      return { ...prev, [slotKey]: arr };
    });
  };

  const toggleInvert = (slotKey, opt, invertVal) => {
    setConfig((prev) => {
      const arr = slotArr(prev, slotKey).map((sc) =>
        sc.source === opt.source && sc.device_id === opt.deviceId && sc.sensor === opt.sensor
          ? { ...sc, invert: invertVal } : sc
      );
      return { ...prev, [slotKey]: arr };
    });
  };

  // HA multi-select: full array replace per slot
  const setHaSlot = (slotKey, unit, newArr) => {
    setConfig((prev) => {
      // Keep non-HA entries, replace HA entries with newArr
      const nonHa = slotArr(prev, slotKey).filter((sc) => sc.source !== "homeassistant");
      return { ...prev, [slotKey]: [...nonHa, ...newArr] };
    });
  };

  const handlePresetSelect = (preset) => {
    const newId = `custom_${Date.now()}`;
    setConfig((prev) => ({
      ...prev,
      custom_nodes: [
        ...(prev.custom_nodes ?? []),
        { ...DEFAULT_CUSTOM_NODE, id: newId, name: preset.label, icon: preset.icon }
      ]
    }));
    setShowPresetPicker(false);
  };

  const handleSave = async () => {
    try {
      saveFlowCfg(config);
      await apiFetch("/api/flow/cfg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaved(true); setError(null); setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="settings-section">
      <div className="settings-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>⚡ Vermogensstroom bronnen</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { loadHw(); loadHa(); loadInflux(); loadSma(); }}>Vernieuwen</button>
      </div>
      <div style={{ padding: "4px 20px 12px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Wijs per positie één of meer sensoren toe. Meerdere bronnen worden opgeteld.
      </div>

      {/* Custom nodes section */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div
          onClick={() => setCollapsedCustom((prev) => !prev)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: collapsedCustom ? 0 : 12,
            padding: "10px 0",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{collapsedCustom ? "▶" : "▼"}</span>
            <div className="settings-row-label" style={{ margin: 0 }}>⚙️ Aangepaste apparaten</div>
            {(config.custom_nodes ?? []).length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {(config.custom_nodes ?? []).length} {(config.custom_nodes ?? []).length === 1 ? "apparaat" : "apparaten"}
              </span>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowPresetPicker(true);
            }}
          >
            + Toevoegen
          </button>
        </div>

        {!collapsedCustom && (
          <>
            {(config.custom_nodes ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>
                Geen aangepaste apparaten. Klik "Toevoegen" om er een te creëren.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {config.custom_nodes.map((node, idx) => {
                  // Collect all sensor options for this custom node
                  const allOptions = [...esphomeOptions, ...hwOptions, ...influxOptions, ...smaOptions, ...haOptions];
                  const selected = node.source ? [node.source] : [];

                  return (
                    <div key={node.id} className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "6px" }}>
                      <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="text" placeholder="Naam" value={node.name || ""}
                          onChange={(e) => {
                            setConfig((prev) => {
                              const updated = [...prev.custom_nodes];
                              updated[idx] = { ...node, name: e.target.value };
                              return { ...prev, custom_nodes: updated };
                            });
                          }}
                          style={{ flex: 1, padding: "6px 8px", fontSize: 12 }}
                        />
                        <input type="text" placeholder="Emoji" maxLength="2" value={node.icon || ""}
                          onChange={(e) => {
                            setConfig((prev) => {
                              const updated = [...prev.custom_nodes];
                              updated[idx] = { ...node, icon: e.target.value };
                              return { ...prev, custom_nodes: updated };
                            });
                          }}
                          style={{ width: "50px", padding: "6px 8px", fontSize: 14, textAlign: "center" }}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          setConfig((prev) => ({
                            ...prev,
                            custom_nodes: prev.custom_nodes.filter((_, i) => i !== idx)
                          }));
                        }} style={{ color: "var(--red)" }}>×</button>
                      </div>

                      <div style={{ width: "100%", fontSize: 11, color: "var(--text-muted)" }}>
                        Selecteer sensor:
                      </div>
                      <MultiSelect
                        options={allOptions}
                        selected={selected}
                        unit="W"
                        currentValues={{}}
                        onChange={(newArr) => {
                          setConfig((prev) => {
                            const updated = [...prev.custom_nodes];
                            updated[idx] = { ...node, source: newArr[0] || null };
                            return { ...prev, custom_nodes: updated };
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {SLOT_ORDER.map((slotKey) => {
        const slotDef = SLOT_DEFS[slotKey];
        const arr     = slotArr(config, slotKey);
        const isCollapsed = collapsedSlots[slotKey];

        // Live total
        let liveTotal = null;
        for (const sc of arr) {
          let cur = null;
          if (sc.source === "esphome") {
            const pm = powerMap[sc.device_id] ?? {};
            cur = pm[sc.sensor] ?? null;
          } else if (sc.source === "homewizard") {
            const dev = hwData?.devices?.find((d) => d.id === sc.device_id);
            cur = dev?.sensors?.[sc.sensor]?.value ?? null;
          } else if (sc.source === "homeassistant") {
            cur = haCurrentValues[sc.sensor] ?? null;
          } else if (sc.source === "influx") {
            cur = influxLive[sc.sensor] ?? null;
          } else if (sc.source === "sma") {
            cur = smaCurrentValues[sc.sensor] ?? null;
          }
          if (cur != null) liveTotal = (liveTotal ?? 0) + (sc.invert ? -cur : cur);
        }

        const compatible  = {
          esphome: esphomeOptions.filter((o) => o.unit === slotDef.unit),
          hw:      hwOptions.filter((o) => o.unit === slotDef.unit),
          ha:      haOptions.filter((o) => o.unit === slotDef.unit),
          influx:  influxOptions.filter((o) => o.unit === slotDef.unit),
          sma:     smaOptions.filter((o) => o.unit === slotDef.unit),
        };
        const haSelected  = arr.filter((sc) => sc.source === "homeassistant");
        const hasAnything = compatible.esphome.length + compatible.hw.length + compatible.ha.length + compatible.influx.length + compatible.sma.length > 0;

        return (
          <div key={slotKey}>
            {/* Collapsible header */}
            <div
              onClick={() => setCollapsedSlots((prev) => ({ ...prev, [slotKey]: !prev[slotKey] }))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 0",
                marginTop: 16,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: 16, minWidth: 16 }}>{isCollapsed ? "▶" : "▼"}</span>
              <div style={{ flex: 1 }}>
                <div className="settings-row-label" style={{ margin: 0 }}>{slotDef.label}</div>
              </div>
              {isCollapsed && arr.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}>
                  {arr.length} {arr.length === 1 ? "bron" : "bronnen"}
                  {liveTotal != null && ` · ${fmtVal(liveTotal, slotDef.unit)}`}
                </span>
              )}
            </div>

            {/* Expanded content */}
            {!isCollapsed && (
              <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingLeft: 24 }}>
                <div style={{ width: "100%" }}>
                  <div className="settings-row-desc">{slotDef.desc}</div>
                  {arr.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                      {arr.length} {arr.length === 1 ? "bron" : "bronnen"} geselecteerd
                      {liveTotal != null && ` · huidig: ${fmtVal(liveTotal, slotDef.unit)}`}
                    </div>
                  )}
                </div>

                {!hasAnything ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Geen {slotDef.unit}-sensoren beschikbaar</div>
                ) : (
                  <div className="flow-sources-grid">
                    {/* ESPHome checkboxes */}
                    {compatible.esphome.length > 0 && (
                      <div className="flow-source-group">
                        <div className="flow-opt-group-label">🔋 ESPHome</div>
                        {compatible.esphome.map((opt) => {
                          const checked = isSelected(arr, opt);
                          const inv     = getInvert(arr, opt);
                          return (
                            <div key={opt.key} className={`flow-opt-row${checked ? " flow-opt-row--checked" : ""}`}>
                              <label className="flow-opt-check">
                                <input type="checkbox" checked={checked}
                                  onChange={(e) => toggleOption(slotKey, opt, e.target.checked)} />
                                <span className="flow-opt-label">{opt.label}</span>
                                {opt.current != null && <span className="flow-opt-val">{fmtVal(opt.current, opt.unit)}</span>}
                              </label>
                              {checked && (
                                <div className="flow-opt-extras">
                                  <label className="flow-opt-invert">
                                    <input type="checkbox" checked={inv}
                                      onChange={(e) => toggleInvert(slotKey, opt, e.target.checked)} />
                                    Omkeren
                                  </label>
                                  {opt.hint && <span className="flow-opt-hint">⚠ {opt.hint}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* HomeWizard checkboxes */}
                    {compatible.hw.length > 0 && (
                      <div className="flow-source-group">
                        <div className="flow-opt-group-label">🏠 HomeWizard</div>
                        {compatible.hw.map((opt) => {
                          const checked = isSelected(arr, opt);
                          const inv     = getInvert(arr, opt);
                          return (
                            <div key={opt.key} className={`flow-opt-row${checked ? " flow-opt-row--checked" : ""}`}>
                              <label className="flow-opt-check">
                                <input type="checkbox" checked={checked}
                                  onChange={(e) => toggleOption(slotKey, opt, e.target.checked)} />
                                <span className="flow-opt-label">{opt.label}</span>
                                {opt.current != null && <span className="flow-opt-val">{fmtVal(opt.current, opt.unit)}</span>}
                              </label>
                              {checked && (
                                <div className="flow-opt-extras">
                                  <label className="flow-opt-invert">
                                    <input type="checkbox" checked={inv}
                                      onChange={(e) => toggleInvert(slotKey, opt, e.target.checked)} />
                                    Omkeren
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* InfluxDB checkboxes */}
                    {compatible.influx.length > 0 && (
                      <div className="flow-source-group">
                        <div className="flow-opt-group-label">📊 InfluxDB</div>
                        {compatible.influx.map((opt) => {
                          const checked = isSelected(arr, opt);
                          const inv     = getInvert(arr, opt);
                          return (
                            <div key={opt.key} className={`flow-opt-row${checked ? " flow-opt-row--checked" : ""}`}>
                              <label className="flow-opt-check">
                                <input type="checkbox" checked={checked}
                                  onChange={(e) => toggleOption(slotKey, opt, e.target.checked)} />
                                <span className="flow-opt-label">{opt.label}</span>
                                {opt.current != null && <span className="flow-opt-val">{fmtVal(opt.current, opt.unit)}</span>}
                              </label>
                              {checked && (
                                <div className="flow-opt-extras">
                                  <label className="flow-opt-invert">
                                    <input type="checkbox" checked={inv}
                                      onChange={(e) => toggleInvert(slotKey, opt, e.target.checked)} />
                                    Omkeren
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* SMA Reader checkboxes */}
                    {compatible.sma.length > 0 && (
                      <div className="flow-source-group">
                        <div className="flow-opt-group-label">☀️ SMA Reader</div>
                        {compatible.sma.map((opt) => {
                          const checked = isSelected(arr, opt);
                          const inv     = getInvert(arr, opt);
                          return (
                            <div key={opt.key} className={`flow-opt-row${checked ? " flow-opt-row--checked" : ""}`}>
                              <label className="flow-opt-check">
                                <input type="checkbox" checked={checked}
                                  onChange={(e) => toggleOption(slotKey, opt, e.target.checked)} />
                                <span className="flow-opt-label">{opt.label}</span>
                                {opt.current != null && <span className="flow-opt-val">{fmtVal(opt.current, opt.unit)}</span>}
                              </label>
                              {checked && (
                                <div className="flow-opt-extras">
                                  <label className="flow-opt-invert">
                                    <input type="checkbox" checked={inv}
                                      onChange={(e) => toggleInvert(slotKey, opt, e.target.checked)} />
                                    Omkeren
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Home Assistant multi-select */}
                    {compatible.ha.length > 0 && (
                      <div className="flow-source-group flow-source-group--ha">
                        <div className="flow-opt-group-label">🤖 Home Assistant</div>
                        <MultiSelect
                          options={compatible.ha}
                          selected={haSelected}
                          unit={slotDef.unit}
                          currentValues={haCurrentValues}
                          onChange={(newArr) => setHaSlot(slotKey, slotDef.unit, newArr)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ padding: "12px 20px 4px", display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Opslaan</button>
        {saved && <span style={{ fontSize: 12, color: "var(--green)" }}>✓ Opgeslagen</span>}
        {error && <span style={{ fontSize: 12, color: "var(--red)" }}>{error}</span>}
      </div>

      {showPresetPicker && (
        <PresetPickerModal
          onClose={() => setShowPresetPicker(false)}
          onSelect={handlePresetSelect}
        />
      )}
    </div>
  );
}
