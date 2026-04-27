import { apiFetch } from "../auth.js";
import { useState, useEffect } from "react";

function Row({ label, desc, children }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

function StatusBadge({ status }) {
  const colors = {
    "Ready": "#4ade80",
    "Running": "#60a5fa",
    "Finished": "#a78bfa",
    "Error": "#f87171",
  };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      backgroundColor: colors[status] || "#94a3b8",
      color: "#fff",
    }}>
      {status}
    </span>
  );
}

function ProgramStartModal({ device, onClose, onStart }) {
  const [programs, setPrograms] = useState([]);
  const [selectedProgram, setSelectedProgram] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchPrograms = async () => {
      try {
        const r = await apiFetch(`api/bosch-appliances/programs/${device.ha_id}`);
        const d = await r.json();
        setPrograms(d.programs || []);
      } catch (e) {
        setError("Failed to load programs");
      }
    };
    fetchPrograms();
  }, [device]);

  const handleStart = async () => {
    if (!selectedProgram) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("api/bosch-appliances/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ha_id: device.ha_id, program_key: selectedProgram }),
      });
      if (!r.ok) throw new Error("Start failed");
      onStart();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)", display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: "var(--bg)", borderRadius: 8, padding: 24, maxWidth: 400, width: "90%",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)", border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Programma starten - {device.name}
        </div>
        {error && <div style={{ padding: 8, backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: 4, marginBottom: 12, fontSize: 13 }}>{error}</div>}
        <select className="form-input" value={selectedProgram} onChange={(e) => setSelectedProgram(e.target.value)}
          style={{ width: "100%", marginBottom: 16 }}>
          <option value="">-- Selecteer programma --</option>
          {programs.map((p) => (
            <option key={p.key} value={p.key}>{p.name}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Annuleren</button>
          <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={!selectedProgram || loading}>
            {loading ? "Starten…" : "Starten"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BoschAppliances() {
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selectedDeviceModal, setSelectedDeviceModal] = useState(null);
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [settings, setSettings] = useState({});
  const [savingSettings, setSavingSettings] = useState({});

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = async () => {
    try {
      const r = await apiFetch("api/bosch-appliances/status");
      const d = await r.json();
      setConnected(d.authenticated || false);
      if (d.authenticated) {
        fetchDevices();
      }
    } catch (e) {
      console.error("Failed to fetch status:", e);
    }
  };

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("api/bosch-appliances/devices");
      const d = await r.json();
      setDevices(d.devices || []);
      await fetchSettings();
    } catch (e) {
      setError("Failed to load devices");
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const r = await apiFetch("api/bosch-appliances/settings");
      const d = await r.json();
      const settingsMap = {};
      (d.settings || []).forEach((s) => {
        settingsMap[s.ha_id] = s;
      });
      setSettings(settingsMap);
    } catch (e) {
      console.error("Failed to fetch settings:", e);
    }
  };

  const handleAuthorize = () => {
    window.location.href = "/api/bosch-appliances/authorize";
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("api/bosch-appliances/disconnect", { method: "POST" });
      if (!r.ok) throw new Error("Disconnect failed");
      setConnected(false);
      setDevices([]);
      setSettings({});
      setSuccess("Bosch-verbinding verwijderd");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopDevice = async (haId) => {
    setError(null);
    try {
      const r = await apiFetch("api/bosch-appliances/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ha_id: haId }),
      });
      if (!r.ok) throw new Error("Stop failed");
      setSuccess("Apparaat gestopt");
      setTimeout(() => setSuccess(null), 3000);
      setTimeout(() => fetchDevices(), 1000);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSaveSettings = async (haId) => {
    setSavingSettings((s) => ({ ...s, [haId]: true }));
    setError(null);
    try {
      const deviceSettings = settings[haId] || {};
      const r = await apiFetch("api/bosch-appliances/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ha_id: haId,
          smart_start_enabled: deviceSettings.smart_start_enabled || false,
          trigger_type: deviceSettings.trigger_type || "solar_surplus",
          solar_surplus_threshold: parseInt(deviceSettings.solar_surplus_threshold) || 0,
          program_key: deviceSettings.program_key || "",
          deadline_time: deviceSettings.deadline_time || "",
          priority: parseInt(deviceSettings.priority) || 0,
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      setSuccess("Instellingen opgeslagen");
      setTimeout(() => setSuccess(null), 3000);
      await fetchSettings();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSettings((s) => ({ ...s, [haId]: false }));
    }
  };

  const updateDeviceSetting = (haId, key, value) => {
    setSettings((s) => ({
      ...s,
      [haId]: { ...s[haId], [key]: value },
    }));
  };

  const getStatusBadgeText = (device, deviceSettings) => {
    if (!deviceSettings?.smart_start_enabled) return null;
    const status = device.smart_start_status;
    if (status === "waiting_trigger") return "Wacht op solar surplus";
    if (status === "running") return "Loopt";
    if (status === "scheduled" && deviceSettings.deadline_time) {
      return `Gepland voor ${deviceSettings.deadline_time}`;
    }
    return null;
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">🏠 Bosch Home Connect</div>

      {error && <div className="form-error" style={{ margin: "0 20px 12px" }}>{error}</div>}
      {success && <div style={{ margin: "0 20px 12px", padding: 10, backgroundColor: "#dcfce7", color: "#166534", borderRadius: 4, fontSize: 13 }}>✓ {success}</div>}

      {/* OAuth2 Connect Section */}
      {!connected ? (
        <div style={{ padding: "20px", backgroundColor: "var(--bg-hover)", borderRadius: 6, margin: "0 20px 16px", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>Je bent niet verbonden met Bosch Home Connect.</div>
          <button className="btn btn-primary" onClick={handleAuthorize} disabled={loading}>
            Verbinden met Bosch
          </button>
        </div>
      ) : (
        <>
          {/* Connected Status */}
          <div style={{ padding: "12px 20px", backgroundColor: "var(--bg-hover)", borderRadius: 6, margin: "0 20px 16px", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--green)" }}>✅ Verbonden met Bosch Home Connect</span>
            <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} disabled={loading}>
              Verwijderen
            </button>
          </div>

          {/* Appliances List */}
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>Laden…</div>
          ) : devices.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Geen apparaten gevonden</div>
          ) : (
            <div>
              {devices.map((device) => {
                const deviceSettings = settings[device.ha_id] || {};
                const statusBadge = getStatusBadgeText(device, deviceSettings);
                return (
                  <div key={device.ha_id} style={{
                    borderBottom: "1px solid var(--border)",
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 12,
                  }}>
                    <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{device.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                        {device.type} • <StatusBadge status={device.status} />
                      </div>
                      {device.active_program && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {device.active_program} ({device.remaining_time || "—"})
                        </div>
                      )}
                      {statusBadge && (
                        <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 4 }}>
                          💡 {statusBadge}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="btn btn-primary btn-sm" onClick={() => setSelectedDeviceModal(device)}>
                        Starten
                      </button>
                      {device.status === "Running" && (
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => handleStopDevice(device.ha_id)}>
                          Stoppen
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpandedDevice(expandedDevice === device.ha_id ? null : device.ha_id)}>
                        {expandedDevice === device.ha_id ? "⬆" : "⬇"} Instellingen
                      </button>
                    </div>

                    {/* Smart-start Settings (Expanded) */}
                    {expandedDevice === device.ha_id && (
                      <div style={{
                        width: "100%",
                        borderTop: "1px solid var(--border)",
                        paddingTop: 12,
                        marginTop: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>Slim starten instellingen</div>

                        <Row label="Slim starten ingeschakeld">
                          <Toggle
                            on={deviceSettings.smart_start_enabled || false}
                            onChange={(v) => updateDeviceSetting(device.ha_id, "smart_start_enabled", v)}
                          />
                        </Row>

                        {deviceSettings.smart_start_enabled && (
                          <>
                            <Row label="Trigger moment" desc="Op basis waarvan apparaat starten">
                              <select className="form-input" value={deviceSettings.trigger_type || "solar_surplus"}
                                onChange={(e) => updateDeviceSetting(device.ha_id, "trigger_type", e.target.value)}
                                style={{ width: 160 }}>
                                <option value="solar_surplus">Zonneoverschot</option>
                                <option value="neg_price">Negatieve prijs</option>
                                <option value="cheap_hours">Goedkope uren</option>
                              </select>
                            </Row>

                            {deviceSettings.trigger_type === "solar_surplus" && (
                              <Row label="Drempel (W)" desc="Minimaal zonneoverschot">
                                <input className="form-input" type="number" min="0" step="100"
                                  value={deviceSettings.solar_surplus_threshold || 0}
                                  onChange={(e) => updateDeviceSetting(device.ha_id, "solar_surplus_threshold", e.target.value)}
                                  style={{ width: 100 }} />
                              </Row>
                            )}

                            <Row label="Programma" desc="Welk programma starten">
                              <select className="form-input" value={deviceSettings.program_key || ""}
                                onChange={(e) => updateDeviceSetting(device.ha_id, "program_key", e.target.value)}
                                style={{ width: 160 }}>
                                <option value="">-- Selecteer --</option>
                                {/* Programs would be populated dynamically in a real implementation */}
                              </select>
                            </Row>

                            <Row label="Deadlinetijd" desc="Spoedeisende voltooiing (optioneel)">
                              <input className="form-input" type="time"
                                value={deviceSettings.deadline_time || ""}
                                onChange={(e) => updateDeviceSetting(device.ha_id, "deadline_time", e.target.value)}
                                style={{ width: 120 }} />
                            </Row>

                            <Row label="Prioriteit" desc="Volgorde (hoger = sneller starten)">
                              <input className="form-input" type="number" min="0" max="10"
                                value={deviceSettings.priority || 0}
                                onChange={(e) => updateDeviceSetting(device.ha_id, "priority", e.target.value)}
                                style={{ width: 80 }} />
                            </Row>
                          </>
                        )}

                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveSettings(device.ha_id)}
                          disabled={savingSettings[device.ha_id]}>
                          {savingSettings[device.ha_id] ? "Opslaan…" : "Opslaan"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Program Start Modal */}
      {selectedDeviceModal && (
        <ProgramStartModal
          device={selectedDeviceModal}
          onClose={() => setSelectedDeviceModal(null)}
          onStart={() => {
            setSelectedDeviceModal(null);
            setSuccess("Apparaat startte");
            setTimeout(() => fetchDevices(), 1000);
          }}
        />
      )}
    </div>
  );
}
