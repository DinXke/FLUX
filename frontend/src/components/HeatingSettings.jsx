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
  const [daikinDevices, setDaikinDevices] = useState([]);
  const [boschDevices, setBoschDevices] = useState([]);
  const [boschPairingIP, setBoschPairingIP] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [gridChargeTemp, setGridChargeTemp] = useState(25);
  const [dischargeTemp, setDischargeTemp] = useState(16);
  const [comfortTemp, setComfortTemp] = useState(21);

  useEffect(() => {
    // Load heating settings
    fetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setHeatingEnabled(d.heating_enabled !== false);
        setGridChargeTemp(d.heating_grid_charge_setpoint ?? 25);
        setDischargeTemp(d.heating_discharge_setpoint ?? 16);
        setComfortTemp(d.heating_comfort_setpoint ?? 21);
      })
      .catch(() => {});

    refreshDevices();
  }, []);

  const refreshDevices = async () => {
    try {
      const daikinRes = await fetch("api/daikin/status");
      const daikinData = await daikinRes.json();
      if (daikinData.authenticated) {
        setDaikinAuth(true);
        const devRes = await fetch("api/daikin/devices");
        const devData = await devRes.json();
        setDaikinDevices(devData.devices || []);
      }
    } catch (e) {}

    try {
      const boschRes = await fetch("api/bosch/status");
      const boschData = await boschRes.json();
      if (boschData.devices_count > 0) {
        const devRes = await fetch("api/bosch/devices");
        const devData = await devRes.json();
        setBoschDevices(devData.devices || []);
      }
    } catch (e) {}
  };

  const saveSetting = async (key, value) => {
    try {
      await fetch("api/strategy/settings", {
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
      const res = await fetch("api/bosch/pair", {
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
      await fetch("api/daikin/logout", { method: "POST" });
      setDaikinAuth(false);
      setDaikinDevices([]);
      setSuccess("Daikin logged out");
    } catch (e) {
      setError("Logout failed");
    }
  };

  const handleBoschUnpair = async (deviceId) => {
    try {
      const res = await fetch("api/bosch/unpair", {
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
          <div style={{ padding: "10px", color: "#666" }}>
            <p>
              OAuth2 login moet in de browser worden ingesteld via de Onecta app. Controleer de
              console voor verdere instructies.
            </p>
            <div style={{ fontSize: "12px", color: "#999", marginTop: "8px" }}>
              Opmerking: Daikin OAuth2 configuratie vereist verdere setup via de Daikin-integratie.
            </div>
          </div>
        )}
      </div>

      <div className="settings-subsection">
        <h3>Bosch Home Connect</h3>
        {boschDevices.length > 0 ? (
          <div>
            <Row label="Status" desc="">
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
            <Row label="Status" desc="">
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
