import { apiFetch } from "../auth.js";
import { useState, useEffect } from "react";
import AddDeviceModal from "./AddDeviceModal.jsx";
import HomeWizardSettings from "./HomeWizardSettings.jsx";
import HomeAssistantSettings from "./HomeAssistantSettings.jsx";
import ForecastSettings from "./ForecastSettings.jsx";
import StrategySettings from "./StrategySettings.jsx";
import InfluxSettings from "./InfluxSettings.jsx";
import FlowSourcesSettings from "./FlowSourcesSettings.jsx";
import PvLimiterSettings from "./PvLimiterSettings.jsx";
import CapTariffSettings from "./CapTariffSettings.jsx";
import RollingCapSettings from "./RollingCapSettings.jsx";
import TelegramSettings from "./TelegramSettings.jsx";
import SmaReaderSettings from "./SmaReaderSettings.jsx";
import HeatingSettings from "./HeatingSettings.jsx";
import BoschAppliances from "./BoschAppliances.jsx";
import ServerUrlSettings from "./ServerUrlSettings.jsx";
import UISettingsPanel from "./UISettingsPanel.jsx";
import AboutSettings from "./AboutSettings.jsx";

// ---------------------------------------------------------------------------
// Persisted settings helpers (localStorage)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "marstek_settings";

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
  catch { return {}; }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function getFlowSettings() {
  const s = loadSettings();
  return { invertAcFlow: s.invertAcFlow ?? false, invertBatFlow: s.invertBatFlow ?? false };
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

// ---------------------------------------------------------------------------
// ENTSO-E section
// ---------------------------------------------------------------------------

const TIMEZONE_OPTIONS = [
  { value: "Europe/Brussels",  label: "Europe/Brussels (België)"   },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (Nederland)" },
  { value: "Europe/London",    label: "Europe/London (VK)"         },
  { value: "Europe/Paris",     label: "Europe/Paris (Frankrijk)"   },
  { value: "Europe/Berlin",    label: "Europe/Berlin (Duitsland)"  },
];
const COUNTRY_OPTIONS = [
  { value: "BE", label: "België (BE)"      },
  { value: "NL", label: "Nederland (NL)"   },
  { value: "DE", label: "Duitsland (DE)"   },
  { value: "FR", label: "Frankrijk (FR)"   },
];

function EntsoESection() {
  const [apiKey,     setApiKey]     = useState("");
  const [configured, setConfigured] = useState(false);
  const [hint,       setHint]       = useState("");
  const [timezone,   setTimezone]   = useState("Europe/Brussels");
  const [country,    setCountry]    = useState("BE");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState(null);
  const [success,    setSuccess]    = useState(false);

  useEffect(() => {
    apiFetch("/api/entsoe/settings").then((r) => r.json()).then((d) => {
      setConfigured(d.configured); setHint(d.apiKeyHint || "");
      if (d.timezone) setTimezone(d.timezone);
      if (d.country)  setCountry(d.country);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const body = { timezone, country };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await apiFetch("/api/entsoe/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");
      if (apiKey.trim()) { setConfigured(true); setHint(`…${apiKey.trim().slice(-4)}`); setApiKey(""); }
      setSuccess(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">⚡ ENTSO-E kwartierprijzen</div>
      <div className="settings-row">
        <div><div className="settings-row-label">Biedzone</div></div>
        <select className="form-input" style={{ width: "auto", minWidth: 160 }}
          value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="settings-row">
        <div><div className="settings-row-label">Tijdzone</div></div>
        <select className="form-input" style={{ width: "auto", minWidth: 240 }}
          value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {TIMEZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="settings-row-label">API sleutel</div>
          <div className="settings-row-desc">
            Gratis via <a href="https://transparency.entsoe.eu" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)" }}>transparency.entsoe.eu</a> → Profiel → Web API Security Token.
          </div>
        </div>
        {configured && <div style={{ fontSize: 12, color: "var(--green)" }}>✅ Geconfigureerd ({hint})</div>}
        {error   && <div className="form-error">{error}</div>}
        {success && <div style={{ fontSize: 12, color: "var(--green)" }}>✓ Opgeslagen</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="form-input" type="password"
            placeholder={configured ? "Nieuwe sleutel (optioneel)" : "API sleutel"}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ flex: "1 1 260px" }} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug panel
// ---------------------------------------------------------------------------

function DebugPanel() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch("/api/debug");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e.message === "Failed to fetch"
        ? "Backend niet bereikbaar – is de Flask-server actief?"
        : e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>🛠️ Debug informatie</span>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? "…" : "Laden"}
        </button>
      </div>
      {error && <div className="form-error" style={{ margin: "0 20px 12px" }}>{error}</div>}
      {data && (
        <>
          <div className="settings-row">
            <div className="settings-row-label">Server tijd</div>
            <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-muted)" }}>{data.server_time}</div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Frank Energie</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {data.frank_logged_in ? `✅ Ingelogd als ${data.frank_email}` : "⬜ Publieke prijzen"}
            </div>
          </div>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div className="settings-row-label">Apparaat bereikbaarheid</div>
            {data.devices.map((d) => {
              const s = data.device_reachability?.[d.id];
              return (
                <div key={d.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
                  <span style={{ color: s?.reachable ? "var(--green)" : "var(--red)" }}>
                    {s?.reachable ? "✅" : "❌"}
                  </span>
                  <span>{d.name}</span>
                  <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{d.ip}:{d.port}</span>
                  {s?.error && <span style={{ color: "var(--red)", fontSize: 11 }}>{s.error}</span>}
                </div>
              );
            })}
            {data.devices.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Geen apparaten</div>}
          </div>
          <div className="settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            <div className="settings-row-label">Log (laatste 50 regels)</div>
            <pre style={{
              margin: 0, padding: "10px 14px", background: "#0a0f1a",
              borderRadius: 6, fontSize: 10, lineHeight: 1.6, color: "#94a3b8",
              overflowX: "auto", width: "100%", maxHeight: 280, overflowY: "auto", boxSizing: "border-box",
            }}>{data.log_tail.join("\n") || "(leeg)"}</pre>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Apparaten
// ---------------------------------------------------------------------------

function TabApparaten({ devices, powerMap, onDeviceAdded, onDeviceEdited, onDeviceDeleted }) {
  const [showAdd,    setShowAdd]    = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [editId,     setEditId]     = useState(null);
  const [editName,   setEditName]   = useState("");
  const [editIp,     setEditIp]     = useState("");
  const [editPort,   setEditPort]   = useState(80);
  const [editMinSoc,     setEditMinSoc]     = useState("");
  const [editMaxSoc,     setEditMaxSoc]     = useState("");
  const [editForcedMode, setEditForcedMode] = useState("");
  const [editSaving,     setEditSaving]     = useState(false);
  const [editError,      setEditError]      = useState(null);
  const [settings,       setSettings]       = useState(loadSettings);

  const openEdit = (d) => {
    setEditId(d.id); setEditName(d.name); setEditIp(d.ip); setEditPort(d.port);
    setEditMinSoc(d.min_soc != null ? String(d.min_soc) : "");
    setEditMaxSoc(d.max_soc != null ? String(d.max_soc) : "");
    setEditForcedMode(d.forced_mode ?? "");
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || !editIp.trim()) { setEditError("Naam en IP zijn verplicht."); return; }
    setEditSaving(true); setEditError(null);
    const body = { name: editName.trim(), ip: editIp.trim(), port: Number(editPort) };
    body.min_soc = editMinSoc !== "" ? parseInt(editMinSoc) : null;
    body.max_soc = editMaxSoc !== "" ? parseInt(editMaxSoc) : null;
    body.forced_mode = editForcedMode || null;
    try {
      const r = await apiFetch(`api/devices/${editId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { setEditError("Opslaan mislukt."); return; }
      onDeviceEdited(await r.json());
      setEditId(null);
    } catch { setEditError("Netwerkfout."); }
    finally { setEditSaving(false); }
  };

  const handleDelete = async (id) => {
    await apiFetch(`api/devices/${id}`, { method: "DELETE" });
    onDeviceDeleted(id); setConfirmDel(null);
  };

  const setSetting = (key, value) => {
    setSettings(saveSettings({ [key]: value }));
    window.dispatchEvent(new Event("marstek_settings_changed"));
  };

  return (
    <>
      {/* Devices */}
      <div className="settings-section">
        <div className="settings-section-title">🔋 Batterij apparaten</div>
        <div className="settings-device-list">
          {devices.length === 0 && (
            <div style={{ padding: "16px 20px", color: "var(--text-muted)", fontSize: 13 }}>
              Nog geen apparaten toegevoegd.
            </div>
          )}
          {devices.map((d) =>
            editId === d.id ? (
              <div key={d.id} className="settings-device-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                {editError && <div className="form-error">{editError}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input className="form-input" style={{ flex: "1 1 180px" }}
                    placeholder="Naam" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input className="form-input" style={{ flex: "1 1 150px" }}
                    placeholder="IP-adres" value={editIp} onChange={(e) => setEditIp(e.target.value)} />
                  <input className="form-input" style={{ width: 80 }}
                    type="number" placeholder="Poort" value={editPort} onChange={(e) => setEditPort(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input className="form-input" style={{ width: 110 }}
                    type="number" min="0" max="50" placeholder="Min SoC %"
                    title="Minimale SoC voor dit apparaat (laat leeg = globale instelling)"
                    value={editMinSoc} onChange={(e) => setEditMinSoc(e.target.value)} />
                  <input className="form-input" style={{ width: 110 }}
                    type="number" min="50" max="100" placeholder="Max SoC %"
                    title="Maximale SoC voor dit apparaat (laat leeg = globale instelling)"
                    value={editMaxSoc} onChange={(e) => setEditMaxSoc(e.target.value)} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>Min/Max SoC (optioneel, per batterij)</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select className="form-input" style={{ flex: "1 1 200px" }}
                    value={editForcedMode}
                    onChange={(e) => setEditForcedMode(e.target.value)}
                    title="Vergrendel de Work Mode van deze batterij, ongeacht wat de automatisering besluit.">
                    <option value="">Automatisch (door planning)</option>
                    <option value="anti-feed">Altijd anti-feed</option>
                    <option value="manual">Altijd handmatig (manual)</option>
                  </select>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                    Work Mode override — wordt direct toegepast
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={editSaving}>
                    {editSaving ? "Opslaan…" : "Opslaan"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Annuleren</button>
                </div>
              </div>
            ) : (
              <div key={d.id} className="settings-device-row">
                <div className="settings-device-info">
                  <div className="settings-device-name">{d.name}</div>
                  <div className="settings-device-ip">
                    {d.ip}:{d.port}
                    {(d.min_soc != null || d.max_soc != null) && (
                      <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 11 }}>
                        SoC: {d.min_soc != null ? `${d.min_soc}%` : "—"}–{d.max_soc != null ? `${d.max_soc}%` : "—"}
                      </span>
                    )}
                    {d.forced_mode && (
                      <span style={{ marginLeft: 8, fontSize: 11, background: "var(--accent)", color: "#fff", borderRadius: 3, padding: "0 5px" }}>
                        🔒 {d.forced_mode}
                      </span>
                    )}
                  </div>
                </div>
                <div className="settings-device-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)}>✏ Bewerken</button>
                  {confirmDel === d.id ? (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>Bevestigen</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>Annuleren</button>
                    </>
                  ) : (
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}
                      onClick={() => setConfirmDel(d.id)}>✕ Verwijderen</button>
                  )}
                </div>
              </div>
            )
          )}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Apparaat toevoegen</button>
        </div>
      </div>

      {/* Flow direction */}
      <div className="settings-section">
        <div className="settings-section-title">⚡ Vermogensrichting</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">AC vermogen omdraaien</div>
            <div className="settings-row-desc">Standaard: positief = terugleveren. Aan = positief is afname.</div>
          </div>
          <Toggle on={settings.invertAcFlow ?? false} onChange={(v) => setSetting("invertAcFlow", v)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Batterijvermogen omdraaien</div>
            <div className="settings-row-desc">Standaard: positief = ontladen. Aan = positief is laden.</div>
          </div>
          <Toggle on={settings.invertBatFlow ?? false} onChange={(v) => setSetting("invertBatFlow", v)} />
        </div>
      </div>

      {/* Display */}
      <div className="settings-section">
        <div className="settings-section-title">🎨 Weergave</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Prijzen in ct/kWh</div>
            <div className="settings-row-desc">Uit = prijzen in €/kWh.</div>
          </div>
          <Toggle on={settings.priceInCents ?? true} onChange={(v) => setSetting("priceInCents", v)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Automatisch vernieuwen</div>
            <div className="settings-row-desc">Prijsdata elke 30 min ophalen.</div>
          </div>
          <Toggle on={settings.autoRefreshPrices ?? true} onChange={(v) => setSetting("autoRefreshPrices", v)} />
        </div>
      </div>

      {showAdd && (
        <AddDeviceModal onClose={() => setShowAdd(false)}
          onAdded={(d) => { onDeviceAdded(d); setShowAdd(false); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings page with 3-category grouped navigation
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    id: "uiterlijk",
    label: "🎨 Uiterlijk",
    tabs: [
      { id: "uiterlijk", label: "🎨 Uiterlijk" },
    ],
  },
  {
    id: "databronnen",
    label: "📡 Data-bronnen",
    tabs: [
      { id: "serverurl",     label: "🌐 Server URL"     },
      { id: "entsoe",        label: "⚡ ENTSO-E"        },
      { id: "homewizard",    label: "🏠 HomeWizard"     },
      { id: "homeassistant", label: "🔗 Home Assistant" },
      { id: "influxdb",      label: "🗄️ InfluxDB"       },
      { id: "flowbronnen",   label: "🔀 Stroom­vlak"    },
    ],
  },
  {
    id: "apparaten",
    label: "🔋 Apparaten & strategie",
    tabs: [
      { id: "apparaten",  label: "🔋 Apparaten"  },
      { id: "strategie",  label: "🧠 Strategie"  },
      { id: "pvlimiter",  label: "☀️ PV Limiter" },
      { id: "smareader",  label: "📡 SMA Reader" },
      { id: "captariff",  label: "💶 Cap Tariff" },
      { id: "rollingcap", label: "📉 Rolling Cap" },
    ],
  },
  {
    id: "integraties",
    label: "🔌 Integraties",
    tabs: [
      { id: "forecast", label: "☀️ Forecast" },
      { id: "telegram", label: "✈️ Telegram" },
      { id: "heating", label: "🌡️ Verwarming" },
      { id: "bosch", label: "🏠 Huishoudapparaten" },
    ],
  },
  {
    id: "debug",
    label: "🛠️ Debug",
    tabs: [
      { id: "debug", label: "🛠️ Debug" },
    ],
  },
  {
    id: "about",
    label: "📱 Over",
    tabs: [
      { id: "about", label: "📱 Over de app" },
    ],
  },
];

function readLS(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function resolveInitialGroup() {
  const saved = readLS("marstek_sg", GROUPS[0].id);
  return GROUPS.some((g) => g.id === saved) ? saved : GROUPS[0].id;
}

function resolveInitialTab(groupId) {
  const group = GROUPS.find((g) => g.id === groupId) || GROUPS[0];
  const saved = readLS(`marstek_st_${groupId}`, group.tabs[0].id);
  return group.tabs.some((t) => t.id === saved) ? saved : group.tabs[0].id;
}

export default function SettingsPage({
  devices,
  powerMap,
  onDeviceAdded,
  onDeviceEdited,
  onDeviceDeleted,
  isMobile,
  theme,
  onThemeChange,
  uiMode,
  onUiModeChange,
  uiVersion,
  onUiVersionChange,
  viewMode,
  onViewModeChange,
}) {
  const [activeGroup, setActiveGroup] = useState(resolveInitialGroup);
  const [activeTab,   setActiveTab]   = useState(() => resolveInitialTab(resolveInitialGroup()));

  const currentGroup = GROUPS.find((g) => g.id === activeGroup) || GROUPS[0];

  const handleGroupChange = (groupId) => {
    setActiveGroup(groupId);
    writeLS("marstek_sg", groupId);
    const tab = resolveInitialTab(groupId);
    setActiveTab(tab);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    writeLS(`marstek_st_${activeGroup}`, tabId);
  };

  return (
    <div className="settings-page">

      {/* ── Desktop: group buttons ── */}
      <div className="settings-groups">
        {GROUPS.map((g) => (
          <button key={g.id}
            className={`settings-group-btn ${activeGroup === g.id ? "active" : ""}`}
            onClick={() => handleGroupChange(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {/* ── Desktop: sub-tabs (only when group has >1 tab) ── */}
      {currentGroup.tabs.length > 1 && (
        <div className="settings-tabs">
          {currentGroup.tabs.map((t) => (
            <button key={t.id}
              className={`settings-tab ${activeTab === t.id ? "active" : ""}`}
              onClick={() => handleTabChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Mobile: select dropdowns ── */}
      <div className="settings-mobile-nav">
        <select value={activeGroup} onChange={(e) => handleGroupChange(e.target.value)}>
          {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        {currentGroup.tabs.length > 1 && (
          <select value={activeTab} onChange={(e) => handleTabChange(e.target.value)}>
            {currentGroup.tabs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
      </div>

      {/* ── Tab content ── */}
      {activeTab === "uiterlijk" && (
        <UISettingsPanel
          isMobile={isMobile}
          theme={theme}
          onThemeChange={onThemeChange}
          uiMode={uiMode}
          onUiModeChange={onUiModeChange}
          uiVersion={uiVersion}
          onUiVersionChange={onUiVersionChange}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      )}
      {activeTab === "serverurl"     && <ServerUrlSettings />}
      {activeTab === "entsoe"        && <EntsoESection />}
      {activeTab === "homewizard"    && <HomeWizardSettings />}
      {activeTab === "homeassistant" && <HomeAssistantSettings />}
      {activeTab === "influxdb"      && <InfluxSettings />}
      {activeTab === "flowbronnen"   && <FlowSourcesSettings devices={devices} powerMap={powerMap ?? {}} />}
      {activeTab === "apparaten"     && (
        <TabApparaten devices={devices} powerMap={powerMap}
          onDeviceAdded={onDeviceAdded} onDeviceEdited={onDeviceEdited} onDeviceDeleted={onDeviceDeleted} />
      )}
      {activeTab === "strategie"  && <StrategySettings />}
      {activeTab === "pvlimiter"  && <PvLimiterSettings />}
      {activeTab === "smareader"  && <SmaReaderSettings />}
      {activeTab === "captariff"  && <CapTariffSettings />}
      {activeTab === "rollingcap" && <RollingCapSettings />}
      {activeTab === "forecast"   && <ForecastSettings />}
      {activeTab === "telegram"   && <TelegramSettings />}
      {activeTab === "heating"    && <HeatingSettings />}
      {activeTab === "bosch"      && <BoschAppliances />}
      {activeTab === "debug"      && <DebugPanel />}
      {activeTab === "about"      && <AboutSettings />}
    </div>
  );
}
