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

export default function HeatingSettings() {
  const [heatingEnabled, setHeatingEnabled] = useState(true);
  const [daikinAuth, setDaikinAuth] = useState(false);
  const [daikinConfigured, setDaikinConfigured] = useState(false);
  const [daikinDevices, setDaikinDevices] = useState([]);
  const [boschDevices, setBoschDevices] = useState([]);
  const [boschPairingIP, setBoschPairingIP] = useState("");
  const [boschHCAuth, setBoschHCAuth] = useState(false);
  const [boschHCConfigured, setBoschHCConfigured] = useState(false);
  const [boschHCDevices, setBoschHCDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [gridChargeTemp, setGridChargeTemp] = useState(25);
  const [dischargeTemp, setDischargeTemp] = useState(16);
  const [comfortTemp, setComfortTemp] = useState(21);
  const [plannerSettings, setPlannerSettings] = useState(null);
  const [activePlan, setActivePlan] = useState(null);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerAvailable, setPlannerAvailable] = useState(true);

  useEffect(() => {
    // Handle OAuth2 callback redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("daikin") === "connected") {
      setSuccess("✓ Daikin Onecta succesvol gekoppeld!");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("daikin") === "error") {
      setError("Daikin login mislukt. Controleer DAIKIN_REDIRECT_URI en probeer opnieuw.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (params.get("bosch") === "connected") {
      setSuccess("✓ Bosch Home Connect succesvol gekoppeld!");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("bosch") === "error") {
      setError("Bosch login mislukt. Controleer BOSCH_APPLIANCES_CLIENT_ID/SECRET en probeer opnieuw.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Load heating settings
    apiFetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setHeatingEnabled(d.heating_enabled !== false);
        setGridChargeTemp(d.heating_grid_charge_setpoint ?? 25);
        setDischargeTemp(d.heating_discharge_setpoint ?? 16);
        setComfortTemp(d.heating_comfort_setpoint ?? 21);
      })
      .catch(() => {});

    refreshDevices();
    loadPlannerSettings();
  }, []);

  const refreshDevices = async () => {
    try {
      const daikinRes = await apiFetch("api/daikin/status");
      const daikinData = await daikinRes.json();
      setDaikinConfigured(daikinData.configured !== false);
      if (daikinData.authenticated) {
        setDaikinAuth(true);
        const devRes = await apiFetch("api/daikin/devices");
        const devData = await devRes.json();
        setDaikinDevices(devData.devices || []);
      }
    } catch (e) {}

    try {
      const boschRes = await apiFetch("api/bosch/status");
      const boschData = await boschRes.json();
      if (boschData.devices_count > 0) {
        const devRes = await apiFetch("api/bosch/devices");
        const devData = await devRes.json();
        setBoschDevices(devData.devices || []);
      }
    } catch (e) {}

    try {
      const hcRes = await apiFetch("api/bosch-appliances/status");
      const hcData = await hcRes.json();
      setBoschHCConfigured(hcData.configured === true);
      if (hcData.authenticated) {
        setBoschHCAuth(true);
        const devRes = await apiFetch("api/bosch-appliances/devices");
        const devData = await devRes.json();
        setBoschHCDevices(devData.appliances || []);
      }
    } catch (e) {}
  };

  const loadPlannerSettings = async () => {
    try {
      const res = await apiFetch("api/daikin/planner/settings");
      if (!res.ok) {
        if (res.status === 404) {
          setPlannerAvailable(false);
        }
        return;
      }
      const data = await res.json();
      setPlannerSettings(data);
      setPlannerAvailable(true);
    } catch (e) {
      setPlannerAvailable(false);
    }
  };

  const savePlannerSettings = async (settings) => {
    try {
      const res = await apiFetch("api/daikin/planner/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setPlannerSettings(data);
      setSuccess("✓ Planner instellingen opgeslagen");
    } catch (e) {
      setError("Kon instellingen niet opslaan");
    }
  };

  const loadActivePlan = async () => {
    try {
      setPlannerLoading(true);
      const res = await apiFetch("api/daikin/plan");
      if (!res.ok) return;
      const data = await res.json();
      setActivePlan(data);
    } catch (e) {
    } finally {
      setPlannerLoading(false);
    }
  };

  const saveSetting = async (key, value) => {
    try {
      await apiFetch("api/strategy/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch (e) {
      console.error("Failed to save setting:", e);
    }
  };

  const handleBoschPair = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("api/bosch/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: boschPairingIP }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pairing failed");
      setSuccess(`✓ Bosch pairing successful! Found ${data.devices_found} devices.`);
      setBoschPairingIP("");
      setTimeout(refreshDevices, 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDaikinLogout = async () => {
    try {
      await apiFetch("api/daikin/logout", { method: "POST" });
      setDaikinAuth(false);
      setDaikinDevices([]);
      setSuccess("Daikin logged out");
    } catch (e) {
      setError("Logout failed");
    }
  };

  const handleBoschUnpair = async (deviceId) => {
    try {
      const res = await apiFetch("api/bosch/unpair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId }),
      });
      if (!res.ok) throw new Error("Unpair failed");
      setSuccess("Device unpaired");
      refreshDevices();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="settings-section">
      <h2>🌡️ Verwarming & Koeling</h2>

      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      <div className="settings-subsection">
        <h3>Automatische Regeling</h3>
        <Row
          label="Verwarming ingeschakeld"
          desc="Automatisch thermostaatsetpoint aanpassen op basis van laad-/ontlaadacties"
        >
          <Toggle
            on={heatingEnabled}
            onChange={(val) => {
              setHeatingEnabled(val);
              saveSetting("heating_enabled", val);
            }}
          />
        </Row>

        <Row label="Setpoint (laden)" desc="Doeltemperatuur bij goedkoop laden (grid_charge)">
          <input
            type="number"
            min="12"
            max="28"
            step="0.5"
            value={gridChargeTemp}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setGridChargeTemp(val);
              saveSetting("heating_grid_charge_setpoint", val);
            }}
            style={{ width: "70px" }}
          />
          °C
        </Row>

        <Row label="Setpoint (ontladen)" desc="Doeltemperatuur bij ontladen uit batterij">
          <input
            type="number"
            min="12"
            max="28"
            step="0.5"
            value={dischargeTemp}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setDischargeTemp(val);
              saveSetting("heating_discharge_setpoint", val);
            }}
            style={{ width: "70px" }}
          />
          °C
        </Row>

        <Row label="Setpoint (comfort)" desc="Doeltemperatuur anders (sparen/neutraal)">
          <input
            type="number"
            min="12"
            max="28"
            step="0.5"
            value={comfortTemp}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setComfortTemp(val);
              saveSetting("heating_comfort_setpoint", val);
            }}
            style={{ width: "70px" }}
          />
          °C
        </Row>
      </div>

      <div className="settings-subsection">
        <h3>Daikin Onecta</h3>
        {daikinAuth ? (
          <div>
            <Row label="Status" desc="">
              <span style={{ color: "green" }}>✓ Ingelogd</span>
            </Row>
            {daikinDevices.length > 0 && (
              <div style={{ marginTop: "10px" }}>
                <div className="settings-row-label">Apparaten ({daikinDevices.length})</div>
                {daikinDevices.map((dev) => (
                  <div
                    key={dev.id}
                    style={{
                      padding: "8px",
                      margin: "6px 0",
                      background: "#f5f5f5",
                      borderRadius: "4px",
                      fontSize: "13px",
                    }}
                  >
                    <strong>{dev.name}</strong>
                    {dev.current_temp !== null && (
                      <div>
                        Huidige temp: {dev.current_temp.toFixed(1)}°C | Setpoint:{" "}
                        {dev.setpoint !== null ? dev.setpoint.toFixed(1) : "?"}°C
                      </div>
                    )}
                    {dev.mode && <div>Modus: {dev.mode}</div>}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleDaikinLogout}
              style={{
                marginTop: "10px",
                padding: "6px 12px",
                background: "#e74c3c",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Uitloggen
            </button>
          </div>
        ) : (
          <div style={{ padding: "10px" }}>
            {daikinConfigured ? (
              <>
                <p style={{ margin: "0 0 12px", color: "#555", fontSize: "13px" }}>
                  Koppel je Daikin Onecta account via OAuth2. Je wordt doorgestuurd naar de
                  Daikin-inlogpagina en teruggeleid naar FLUX.
                </p>
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      const res = await apiFetch("api/daikin/authorize");
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Kon auth URL niet ophalen");
                      window.location.href = data.auth_url;
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    background: "#0071CE",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  🔑 Login met Daikin Onecta
                </button>
              </>
            ) : (
              <div>
                <p style={{ margin: "0 0 8px", color: "#555", fontSize: "13px" }}>
                  Daikin Onecta is nog niet geconfigureerd. Voeg de volgende variabelen toe aan je{" "}
                  <code>.env</code>:
                </p>
                <pre style={{
                  background: "#f0f0f0", padding: "10px", borderRadius: "4px",
                  fontSize: "12px", margin: "0 0 8px",
                }}>
{`DAIKIN_REDIRECT_URI=http://<jouw-flux-ip>:5000/api/daikin/callback`}
                </pre>
                <div style={{ fontSize: "12px", color: "#777" }}>
                  Daikin Onecta gebruikt PKCE (geen client secret nodig). Stel enkel de redirect URI in zodat de callback werkt.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {plannerAvailable && daikinAuth && daikinDevices.length > 0 && (
        <div className="settings-subsection">
          <h3>🌞 Daikin Smart Planner</h3>
          {plannerSettings ? (
            <div>
              <Row
                label="Smart planning actief"
                desc="Activeer slim plannen op basis van energieprijzen en zonne-overschot"
              >
                <Toggle
                  on={plannerSettings.enabled || false}
                  onChange={(val) => {
                    const updated = { ...plannerSettings, enabled: val };
                    setPlannerSettings(updated);
                    savePlannerSettings(updated);
                  }}
                />
              </Row>

              <Row label="Zon-overschot drempel (W)" desc="Minimum zonne-overschot voor warmtepompactivatie">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={plannerSettings.solar_surplus_threshold_w || 500}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    const updated = { ...plannerSettings, solar_surplus_threshold_w: val };
                    setPlannerSettings(updated);
                    savePlannerSettings(updated);
                  }}
                  style={{ width: "90px" }}
                />
              </Row>

              <div style={{ marginTop: "16px", borderTop: "1px solid #e0e0e0", paddingTop: "12px" }}>
                <div className="settings-row-label" style={{ marginBottom: "12px" }}>
                  Apparaat-instellingen
                </div>

                {daikinDevices.map((device) => {
                  const deviceSettings = plannerSettings.devices?.[device.id] || {
                    enabled: false,
                    comfort_setpoint: 21,
                    buffer_setpoint: 24,
                    min_setpoint: 16,
                    max_setpoint: 28,
                    deadline_enabled: false,
                    deadline_hour: 7,
                    min_runtime_hours: 2,
                  };

                  const handleDeviceChange = (field, value) => {
                    const updated = {
                      ...plannerSettings,
                      devices: {
                        ...plannerSettings.devices,
                        [device.id]: { ...deviceSettings, [field]: value },
                      },
                    };
                    setPlannerSettings(updated);
                    savePlannerSettings(updated);
                  };

                  const bufferComfortWarning = deviceSettings.buffer_setpoint < deviceSettings.comfort_setpoint;
                  const maxBufferWarning = deviceSettings.max_setpoint < deviceSettings.buffer_setpoint;
                  const minComfortWarning = deviceSettings.min_setpoint > deviceSettings.comfort_setpoint;

                  return (
                    <div
                      key={device.id}
                      style={{
                        margin: "12px 0",
                        padding: "12px",
                        background: "#f9f9f9",
                        borderRadius: "6px",
                        border: "1px solid #e0e0e0",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <div className="settings-row-label">{device.name}</div>
                        <Toggle
                          on={deviceSettings.enabled}
                          onChange={(val) => handleDeviceChange("enabled", val)}
                        />
                      </div>

                      {deviceSettings.enabled && (
                        <div>
                          <Row label="Comfort setpoint (°C)" desc="">
                            <input
                              type="number"
                              min="16"
                              max="28"
                              step="0.5"
                              value={deviceSettings.comfort_setpoint}
                              onChange={(e) => handleDeviceChange("comfort_setpoint", parseFloat(e.target.value))}
                              style={{ width: "60px" }}
                            />
                          </Row>

                          <Row label="Buffer setpoint (°C)" desc="Setpoint bij zonne-overschot of negatieve prijs">
                            <input
                              type="number"
                              min="16"
                              max="28"
                              step="0.5"
                              value={deviceSettings.buffer_setpoint}
                              onChange={(e) => handleDeviceChange("buffer_setpoint", parseFloat(e.target.value))}
                              style={{ width: "60px", borderColor: bufferComfortWarning ? "#e74c3c" : "#ccc" }}
                            />
                            {bufferComfortWarning && (
                              <div style={{ color: "#e74c3c", fontSize: "12px", marginLeft: "8px" }}>
                                ⚠ Buffer moet ≥ comfort zijn
                              </div>
                            )}
                          </Row>

                          <Row label="Min setpoint (°C)" desc="">
                            <input
                              type="number"
                              min="10"
                              max="28"
                              step="0.5"
                              value={deviceSettings.min_setpoint}
                              onChange={(e) => handleDeviceChange("min_setpoint", parseFloat(e.target.value))}
                              style={{ width: "60px", borderColor: minComfortWarning ? "#e74c3c" : "#ccc" }}
                            />
                            {minComfortWarning && (
                              <div style={{ color: "#e74c3c", fontSize: "12px", marginLeft: "8px" }}>
                                ⚠ Min moet ≤ comfort zijn
                              </div>
                            )}
                          </Row>

                          <Row label="Max setpoint (°C)" desc="">
                            <input
                              type="number"
                              min="16"
                              max="35"
                              step="0.5"
                              value={deviceSettings.max_setpoint}
                              onChange={(e) => handleDeviceChange("max_setpoint", parseFloat(e.target.value))}
                              style={{ width: "60px", borderColor: maxBufferWarning ? "#e74c3c" : "#ccc" }}
                            />
                            {maxBufferWarning && (
                              <div style={{ color: "#e74c3c", fontSize: "12px", marginLeft: "8px" }}>
                                ⚠ Max moet ≥ buffer zijn
                              </div>
                            )}
                          </Row>

                          <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid #e0e0e0" }}>
                            <Row label="Deadline ingeschakeld" desc="">
                              <Toggle
                                on={deviceSettings.deadline_enabled}
                                onChange={(val) => handleDeviceChange("deadline_enabled", val)}
                              />
                            </Row>

                            {deviceSettings.deadline_enabled && (
                              <div>
                                <Row label="Doeluur (warmte om X uur)" desc="">
                                  <input
                                    type="number"
                                    min="0"
                                    max="23"
                                    value={deviceSettings.deadline_hour}
                                    onChange={(e) => handleDeviceChange("deadline_hour", parseInt(e.target.value))}
                                    style={{ width: "50px" }}
                                  />
                                  uur
                                </Row>

                                <Row label="Min. draaitijd (uren)" desc="">
                                  <input
                                    type="number"
                                    min="1"
                                    max="8"
                                    step="0.5"
                                    value={deviceSettings.min_runtime_hours}
                                    onChange={(e) => handleDeviceChange("min_runtime_hours", parseFloat(e.target.value))}
                                    style={{ width: "50px" }}
                                  />
                                </Row>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={loadActivePlan}
                disabled={plannerLoading}
                style={{
                  marginTop: "12px",
                  padding: "6px 12px",
                  background: "#3498db",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {plannerLoading ? "Laden..." : "Huidig plan weergeven"}
              </button>

              {activePlan && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px",
                    background: "#f0f8ff",
                    borderRadius: "4px",
                    fontSize: "13px",
                  }}
                >
                  <strong>Huidig uurplan:</strong>
                  {activePlan.plan && activePlan.plan.length > 0 ? (
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: "20px" }}>
                      {activePlan.plan.map((hour, idx) => (
                        <li key={idx}>
                          {hour.device}: {hour.setpoint}°C ({hour.reason})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ marginTop: "6px", color: "#666" }}>
                      Geen actief plan — schakel de planner in
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "10px", color: "#666" }}>
              <p>Planner instellingen laden...</p>
            </div>
          )}
        </div>
      )}

      {!plannerAvailable && daikinAuth && daikinDevices.length > 0 && (
        <div className="settings-subsection" style={{ opacity: 0.6 }}>
          <h3>🌞 Daikin Smart Planner</h3>
          <div style={{ padding: "10px", color: "#999" }}>
            Planner niet beschikbaar op dit moment
          </div>
        </div>
      )}

      <div className="settings-subsection">
        <h3>Bosch Home Connect</h3>

        {/* Cloud OAuth2 section */}
        {boschHCAuth ? (
          <div style={{ marginBottom: "12px" }}>
            <Row label="Home Connect" desc="Cloud-koppeling">
              <span style={{ color: "green" }}>✓ {boschHCDevices.length} toestel{boschHCDevices.length !== 1 ? "len" : ""}</span>
            </Row>
            {boschHCDevices.map((dev) => (
              <div
                key={dev.haId || dev.name}
                style={{
                  padding: "8px",
                  margin: "6px 0",
                  background: "#f5f5f5",
                  borderRadius: "4px",
                  fontSize: "13px",
                }}
              >
                <strong>{dev.name || dev.haId}</strong>
                {dev.brand && <span style={{ color: "#777", marginLeft: "6px" }}>{dev.brand}</span>}
                {dev.type && <span style={{ color: "#999", marginLeft: "6px" }}>({dev.type})</span>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "10px", marginBottom: "12px", background: "#fafafa", borderRadius: "4px", border: "1px solid #eee" }}>
            <div style={{ fontWeight: "bold", fontSize: "13px", marginBottom: "8px" }}>Home Connect cloud</div>
            {boschHCConfigured ? (
              <>
                <p style={{ margin: "0 0 10px", color: "#555", fontSize: "13px" }}>
                  Koppel je Bosch Home Connect account via OAuth2. Je wordt doorgestuurd naar de
                  Bosch-inlogpagina en teruggeleid naar FLUX.
                </p>
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      const res = await apiFetch("api/bosch-appliances/authorize");
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Kon auth URL niet ophalen");
                      window.location.href = data.auth_url;
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    background: "#00529b",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  🔑 Login met Bosch Home Connect
                </button>
              </>
            ) : (
              <div>
                <p style={{ margin: "0 0 8px", color: "#555", fontSize: "13px" }}>
                  Bosch Home Connect is nog niet geconfigureerd. Voeg de volgende variabelen toe aan je{" "}
                  <code>.env</code>:
                </p>
                <pre style={{
                  background: "#f0f0f0", padding: "10px", borderRadius: "4px",
                  fontSize: "12px", margin: "0 0 8px",
                }}>
{`BOSCH_APPLIANCES_CLIENT_ID=<jouw client id>
BOSCH_APPLIANCES_CLIENT_SECRET=<jouw client secret>
BOSCH_APPLIANCES_REDIRECT_URI=http://<jouw-flux-ip>:5000/api/bosch-appliances/callback`}
                </pre>
                <div style={{ fontSize: "12px", color: "#777" }}>
                  Registreer op{" "}
                  <a
                    href="https://developer.home-connect.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#00529b" }}
                  >
                    developer.home-connect.com
                  </a>{" "}
                  om je client ID en secret te krijgen.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Local bridge section */}
        {boschDevices.length > 0 ? (
          <div>
            <Row label="Lokale brug" desc="">
              <span style={{ color: "green" }}>✓ {boschDevices.length} apparaten</span>
            </Row>
            {boschDevices.map((dev) => (
              <div
                key={dev.device_id}
                style={{
                  padding: "8px",
                  margin: "6px 0",
                  background: "#f5f5f5",
                  borderRadius: "4px",
                  fontSize: "13px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>{dev.name || dev.device_id}</strong>
                  {dev.current_temp !== null && (
                    <div>
                      Huidige temp: {dev.current_temp.toFixed(1)}°C | Setpoint:{" "}
                      {dev.setpoint !== null ? dev.setpoint.toFixed(1) : "?"}°C
                    </div>
                  )}
                  {dev.error && <div style={{ color: "#e74c3c" }}>Fout: {dev.error}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <Row label="Lokale brug" desc="">
              <span style={{ color: "#999" }}>Niet gekoppeld</span>
            </Row>
            <div
              style={{
                marginTop: "10px",
                padding: "10px",
                background: "#f0f0f0",
                borderRadius: "4px",
              }}
            >
              <div style={{ marginBottom: "8px", fontSize: "13px" }}>
                <strong>Bridge IP-adres:</strong>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="192.168.1.100"
                  value={boschPairingIP}
                  onChange={(e) => setBoschPairingIP(e.target.value)}
                  style={{ flex: 1, padding: "6px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
                <button
                  onClick={handleBoschPair}
                  disabled={loading || !boschPairingIP.trim()}
                  style={{
                    padding: "6px 12px",
                    background: "#27ae60",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    opacity: loading || !boschPairingIP.trim() ? 0.5 : 1,
                  }}
                >
                  {loading ? "Koppelen..." : "Koppelen"}
                </button>
              </div>
              <div style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
                Druk binnen 30 seconden op de knop op de Bosch-brug
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
