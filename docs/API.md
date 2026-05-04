# FLUX API-documentatie

Dit document beschrijft alle Flask API-endpoints van FLUX (de energiebesturingapplicatie). Alle endpoints beginnen met `/api/`.

**Legenda:**
- `GET` — gegevens ophalen (safe)
- `POST` — nieuwe gegevens aanmaken/actie uitvoeren
- `PUT` / `PATCH` — gegevens wijzigen
- `DELETE` — gegevens verwijderen
- 🔒 — admin-rechten vereist
- 📍 — Home Assistant add-on specifiek

---

## 🔐 Authenticatie

Beheer van gebruikersaccounts en inloggen.

### `POST /api/auth/login`
Inloggen met e-mailadres en wachtwoord.

**Verzoek:**
```json
{
  "email": "user@example.com",
  "password": "geheim"
}
```

**Antwoord:**
```json
{
  "ok": true,
  "token": "eyJ...",
  "email": "user@example.com",
  "role": "admin"
}
```

---

### `POST /api/auth/logout` 🔒
Uitloggen (frontside token verwijdering).

**Antwoord:**
```json
{
  "ok": true,
  "message": "Token should be deleted on client side"
}
```

---

### `GET /api/auth/me`
Huidige ingelogde gebruiker ophalen.

**Antwoord:**
```json
{
  "ok": true,
  "id": "user-id",
  "email": "user@example.com",
  "role": "admin"
}
```

---

### `GET /api/users` 🔒
Alle gebruikers opsommen (admin only).

**Antwoord:**
```json
{
  "ok": true,
  "users": [
    {
      "id": "user-id",
      "email": "user@example.com",
      "role": "admin",
      "created_at": "2025-01-20T10:30:00Z"
    }
  ]
}
```

---

### `POST /api/users` 🔒
Nieuwe gebruiker aanmaken (admin only).

**Verzoek:**
```json
{
  "email": "newuser@example.com",
  "password": "geheim",
  "role": "admin"
}
```

---

### `PATCH /api/users/<user_id>` 🔒
Gebruiker bijwerken: wachtwoord of rol (admin only).

**Verzoek:**
```json
{
  "password": "nieuw-geheim",
  "role": "readonly"
}
```

---

### `DELETE /api/users/<user_id>` 🔒
Gebruiker verwijderen (admin only).

---

## 🔌 Apparaatbeheer (ESPHome-batterijen)

Beheer van ESPHome-batterijen via het lokale netwerk.

### `GET /api/devices`
Alle geregistreerde ESPHome-batterijen ophalen.

**Antwoord:**
```json
[
  {
    "id": "device-uuid",
    "name": "Voorkamer batterij",
    "ip": "192.168.1.100",
    "port": 80,
    "min_soc": 10,
    "max_soc": 95,
    "forced_mode": null
  }
]
```

---

### `POST /api/devices` 🔒
Nieuwe ESPHome-batterij toevoegen.

**Verzoek:**
```json
{
  "name": "Voorkamer batterij",
  "ip": "192.168.1.100",
  "port": 80,
  "min_soc": 10,
  "max_soc": 95
}
```

---

### `PUT /api/devices/<device_id>` 🔒
ESPHome-batterij instellingen bijwerken (naam, IP, min/max SoC, geforceerde modus).

**Verzoek:**
```json
{
  "name": "Voorkamer batterij (updated)",
  "min_soc": 15,
  "max_soc": 90,
  "forced_mode": "anti-feed"
}
```

---

### `DELETE /api/devices/<device_id>` 🔒
ESPHome-batterij verwijderen.

---

### `GET /api/devices/<device_id>/stream`
**Server-Sent Events (SSE) stream** van live ESPHome-sensordata.

Stream voorziet real-time updates: spanning, stroom, laadstatus, werkingsmodus, foutmeldingen.

**Voorbeeld stream:**
```
event: state
data: {"entity_id":"inverter.state","state":"charge"}

event: state
data: {"entity_id":"battery.soc","state":"75.5"}
```

---

### `POST /api/devices/<device_id>/command` 🔒
Commando naar ESPHome-apparaat sturen (bv. laadmodus wijzigen).

**Verzoek:**
```json
{
  "domain": "select",
  "name": "Marstek User Work Mode",
  "value": "charge"
}
```

**Antwoord:**
```json
{
  "ok": true,
  "status": 200
}
```

---

## 💰 Frank Energie (stroomtarief & verbruik)

Authenticatie en prijsgegevens van Frank Energie.

### `GET /api/status`
Systeemstatus controleren.

**Antwoord:**
```json
{
  "ok": true,
  "service": "flux",
  "status": "running"
}
```

---

### `POST /api/frank/login`
Inloggen op Frank Energie (e-mail + wachtwoord).

**Verzoek:**
```json
{
  "email": "user@frank.nl",
  "password": "geheim"
}
```

**Antwoord:**
```json
{
  "ok": true,
  "email": "user@frank.nl"
}
```

---

### `POST /api/frank/logout`
Frank Energie-sessie verwijderen.

**Antwoord:**
```json
{
  "ok": true
}
```

---

### `GET /api/frank/status`
Frank Energie inlogstatus controleren.

**Antwoord:**
```json
{
  "loggedIn": true,
  "email": "user@frank.nl",
  "country": "NL"
}
```

---

### `GET /api/prices/electricity`
Huidige & morgen stroomtarieven ophalen (per uur).

**Antwoord:**
```json
{
  "today": [
    {
      "from": "2025-01-20T00:00:00Z",
      "till": "2025-01-20T01:00:00Z",
      "marketPrice": 0.12,
      "perUnit": "kWh"
    }
  ],
  "tomorrow": [],
  "loggedIn": true,
  "email": "user@frank.nl"
}
```

---

### `GET /api/frank/consumption?startDate=2025-01-20&endDate=2025-01-21`
Verbruik & kosten per uur ophalen (Frank Energie; NL & BE).

**Antwoord:**
```json
[
  {
    "date": "2025-01-20",
    "label": "00:00",
    "from": "2025-01-20T00:00:00Z",
    "till": "2025-01-20T01:00:00Z",
    "frank_kwh": 0.5,
    "frank_cost_eur": 0.06
  }
]
```

---

### `GET /api/frank/consumption-test`
Debug-endpoint voor Frank Energie API-problemen (token vernieuwing, userSites, periodUsageAndCosts).

---

### `GET /api/frank/today-consumption`
Vandaag's totaal verbruik via Frank (Home Assistant sensor).

**Antwoord:**
```json
{
  "value": 5.25,
  "unit": "kWh"
}
```

---

### `GET /api/p1/today-consumption`
Vandaag's totaal P1-meter verbruik (grid import in kWh).

**Antwoord:**
```json
{
  "value": 3.75,
  "unit": "kWh"
}
```

---

## 🌡️ Daikin Onecta (airconditioner)

Authenticatie en bediening van Daikin airco's.

### `GET /api/daikin/status`
Daikin-verbindingsstatus controleren.

**Antwoord:**
```json
{
  "authenticated": true,
  "email": "user@daikin.com",
  "region": "EU",
  "updated_at": "2025-01-20T10:30:00Z"
}
```

---

### `GET /api/daikin/authorize`
Daikin OAuth2-autorisatie-URL verkrijgen.

**Antwoord:**
```json
{
  "auth_url": "https://accounts.daikincomfort.com/oauth?..."
}
```

---

### `GET /api/daikin/callback`
OAuth2-callback (na gebruiker toestemming geeft op Daikin-website).

---

### `POST /api/daikin/logout` 🔒
Daikin-verbinding verwijderen.

---

### `GET /api/daikin/devices`
Alle gekoppelde Daikin-apparaten ophalen.

**Antwoord:**
```json
{
  "devices": [
    {
      "id": "daikin-device-id",
      "name": "Woonkamer AC",
      "model": "FTXJ20N",
      "power": true,
      "temperature": 21.5,
      "mode": "cool"
    }
  ]
}
```

---

### `POST /api/daikin/set-temperature` 🔒
Daikin temperatuur instellen.

**Verzoek:**
```json
{
  "device_id": "daikin-device-id",
  "target_celsius": 21.0
}
```

---

### `POST /api/daikin/set-power` 🔒
Daikin aan/uit zetten.

**Verzoek:**
```json
{
  "device_id": "daikin-device-id",
  "power_on": true
}
```

---

### `GET /api/daikin/planner/settings`
Daikin Smart Planner instellingen ophalen (zonnepanelen laden).

---

### `POST /api/daikin/planner/settings` 🔒
Daikin Smart Planner instellingen opslaan.

**Verzoek:**
```json
{
  "enabled": true,
  "solar_surplus_threshold_w": 500,
  "devices": {
    "device-id": {"solar_surplus_threshold_w": 500}
  }
}
```

---

### `GET /api/daikin/plan`
Gesuggereerde Daikin-laadplan (op basis van zonneforecast & prijzen).

**Antwoord:**
```json
{
  "plan": [
    {
      "device": "device-id",
      "setpoint": 22.0,
      "reason": "Zon overschot op 11:00"
    }
  ]
}
```

---

## 🏠 Bosch Home Connect (witgoedapparaten)

Authenticatie en bediening van Bosch witgoed.

### `GET /api/bosch-appliances/status`
Bosch-verbindingsstatus controleren.

**Antwoord:**
```json
{
  "authenticated": true,
  "configured": true,
  "sandbox": false,
  "updated_at": "2025-01-20T10:30:00Z"
}
```

---

### `GET /api/bosch-appliances/authorize`
Bosch OAuth2-autorisatie-URL ophalen.

---

### `GET /api/bosch-appliances/callback`
OAuth2-callback (na toestemming op Bosch).

---

### `GET /api/bosch-appliances/devices`
Alle gekoppelde Bosch-apparaten ophalen.

**Antwoord:**
```json
{
  "appliances": [
    {
      "haId": "bosch-id",
      "name": "Wasmachine",
      "type": "Washer",
      "programs": ["cotton40", "delicate"]
    }
  ]
}
```

---

### `POST /api/bosch-appliances/start` 🔒
Bosch-apparaat programma starten.

**Verzoek:**
```json
{
  "ha_id": "bosch-id",
  "program_key": "cotton40"
}
```

---

### `POST /api/bosch-appliances/stop` 🔒
Bosch-apparaat stoppen.

---

### `GET /api/bosch-appliances/settings`
Bosch-instellingen ophalen.

---

### `POST /api/bosch-appliances/settings` 🔒
Bosch-instellingen opslaan.

---

## 📊 HomeWizard (P1-meter & slimme stopcontacten)

Lokale API voor HomeWizard Energy apparaten (P1-meter, stopcontacten).

### `GET /api/homewizard/devices`
Alle geregistreerde HomeWizard-apparaten ophalen.

**Antwoord:**
```json
[
  {
    "id": "hw-uuid",
    "name": "P1-meter voordeur",
    "ip": "192.168.1.50",
    "api_version": 2,
    "product_type": "METER_DATA_3P",
    "product_name": "P1 Meter",
    "selected_sensors": ["power_w", "energy_import_kwh"]
  }
]
```

---

### `POST /api/homewizard/devices` 🔒
Nieuwe HomeWizard-apparaat toevoegen (auto-probe: v1 of v2).

**Verzoek:**
```json
{
  "ip": "192.168.1.50",
  "name": "P1-meter",
  "api_version": 2,
  "token": "abc123def456..."
}
```

---

### `PATCH /api/homewizard/devices/<device_id>` 🔒
HomeWizard-apparaat bijwerken (naam, icon).

---

### `DELETE /api/homewizard/devices/<device_id>` 🔒
HomeWizard-apparaat verwijderen.

---

### `GET /api/homewizard/devices/<device_id>/discover`
Beschikbare sensoren van HomeWizard-apparaat detecteren (met live waarden).

**Antwoord:**
```json
{
  "device": { ... },
  "sensors": [
    {
      "key": "power_w",
      "label": "Vermogen totaal",
      "unit": "W",
      "group": "Vermogen",
      "value": 150,
      "selected": true
    }
  ]
}
```

---

### `PUT /api/homewizard/devices/<device_id>/sensors` 🔒
Gekozen sensoren opslaan voor een HomeWizard-apparaat.

**Verzoek:**
```json
{
  "sensors": ["power_w", "energy_import_kwh"]
}
```

---

### `POST /api/homewizard/devices/<device_id>/pair` 🔒
HomeWizard v2-apparaat koppelen via fysieke knop (30 s timeout).

---

### `GET /api/homewizard/data`
Alle HomeWizard-apparaten ophalen met live sensorwaarden.

**Antwoord:**
```json
{
  "devices": [
    {
      "id": "hw-uuid",
      "name": "P1-meter",
      "product_type": "METER_DATA_3P",
      "api_version": 2,
      "reachable": true,
      "sensors": {
        "power_w": {
          "value": 150,
          "label": "Vermogen totaal",
          "unit": "W",
          "power": true
        }
      },
      "error": null
    }
  ],
  "ts": 1705753800
}
```

---

### `GET /api/homewizard/localsubnet`
Lokale /24-subnet detecteren (voor device scanning).

---

### `GET /api/homewizard/scan?subnet=192.168.1.0/24`
Subnet scannen op HomeWizard-apparaten (parallel probing).

**Antwoord:**
```json
{
  "subnet": "192.168.1.0/24",
  "found": [
    {
      "ip": "192.168.1.50",
      "product_type": "METER_DATA_3P",
      "firmware_version": "4.22"
    }
  ]
}
```

---

### `GET /api/homewizard/probe?ip=192.168.1.50`
Debug-endpoint: rauwe probe van HomeWizard-apparaat.

---

## 🏠 Bosch Home Connect (thermostaten)

Authenticatie en bediening van Bosch thermostaten (ander product dan appliances).

### `GET /api/bosch/status`
Bosch-apparaten status (legacy endpoint).

---

### `POST /api/bosch/pair` 🔒
Bosch-apparaat koppelen via IP-adres (fysieke knop 30 s).

---

### `GET /api/bosch/devices`
Gekoppelde Bosch-thermostaten ophalen met huidige staat.

---

### `POST /api/bosch/set-thermostat` 🔒
Bosch-thermostaat temperatuur instellen.

---

### `POST /api/bosch/set-power` 🔒
Bosch-thermostaat aan/uit zetten.

---

### `POST /api/bosch/unpair` 🔒
Bosch-apparaat uit registratie verwijderen.

---

## 🔀 Flow-configuratie (stroomdiagram)

Configuratie van het stroomdiagram: bronnen toewijzen aan slots.

### `GET /api/flow/sources`
Huidige flow-slot-configuratie ophalen.

**Antwoord:**
```json
{
  "net_power": "homewizard_device_id:power_w",
  "bat_power": "esphome_device_id:battery_power_w",
  "voltage_l1": "homewizard_device_id:voltage_l1_v"
}
```

---

### `PUT /api/flow/sources` 🔒
Flow-bronnen configureren (welke sensor → welke slot).

**Verzoek:**
```json
{
  "net_power": "hw-uuid:power_w",
  "bat_power": "esphome-uuid:battery_power_w"
}
```

---

### `GET /api/flow/options`
Alle beschikbare HomeWizard-sensoren en SMA-wattages voor flow-configuratie.

---

### `GET /api/flow/live`
**Server-Sent Events stream** van live flow-data (net, batterij, voltages).

---

### `GET /api/flow/cfg`
Flow-diagramconfiguratie ophalen (geavanceerd).

---

### `POST /api/flow/cfg` 🔒
Flow-diagramconfiguratie opslaan (geavanceerd).

---

## ☀️ Zonneforecast (Forecast.Solar)

Zonneenergie-voorspellingen.

### `GET /api/forecast/settings`
Forecast-instellingen ophalen (locatie, panelkW, kantelhoek).

**Antwoord:**
```json
{
  "lat": 51.5074,
  "lon": 4.4852,
  "kw": 8.0,
  "loss": 0.15,
  "timezone": "Europe/Amsterdam"
}
```

---

### `POST /api/forecast/settings` 🔒
Forecast-instellingen bijwerken.

---

### `GET /api/forecast/estimate`
Dagelijkse zonneproductie-schatting (op basis van forecast).

---

### `GET /api/forecast/actuals`
Werkelijke PV-productie per uur (historisch, uit InfluxDB).

---

### `GET /api/forecast/actual-source`
Huidige bron van actuele PV-gegevens (HomeWizard, SMA, HA).

---

### `POST /api/forecast/actual-source` 🔒
Bron van actuele PV-gegevens wijzigen.

---

### `GET /api/forecast/prophet`
Consumptieforecast voor komende 7 dagen (Prophet ML-model).

---

## 💸 Prijsgegevens (ENTSO-E)

Stroomtariefdaten van ENTSO-E API.

### `GET /api/entsoe/settings`
ENTSO-E-instellingen ophalen (api-key, timezone, bidding zone).

---

### `POST /api/entsoe/settings` 🔒
ENTSO-E-instellingen bijwerken.

---

### `GET /api/prices/entsoe`
ENTSO-E stroomtarieven ophalen (fallback als Frank niet beschikbaar).

---

### `GET /api/energie-advies/prices`
Energie-advies stroomtarieven ophalen (BE).

---

## 📋 Automatisering (regelstrategie)

Beheer van FLUX-regelstrategie (regel-gebaseerd of AI).

### `GET /api/strategy/settings`
Huidige regelstrategie-instellingen ophalen.

**Antwoord:**
```json
{
  "mode": "rule_based",
  "min_reserve_soc": 10,
  "max_soc": 95,
  "grid_charge_allowed": false,
  "frank_auth_token": "...",
  "use_claude": false,
  "claude_model": "claude-opus-4-5",
  "openai_api_key": ""
}
```

---

### `POST /api/strategy/settings` 🔒
Regelstrategie-instellingen opslaan.

---

### `PATCH /api/strategy/settings` 🔒
Regelstrategie-instellingen partieel bijwerken.

---

### `GET /api/strategy/plan`
Actueel 24-uurs laad-/ontladingsplan (voor vandaag).

**Antwoord:**
```json
{
  "plan": [
    {
      "hour": 0,
      "action": "charge",
      "target_soc": 80,
      "reason": "Goedkope stroom in 00:00-06:00"
    }
  ],
  "timestamp": "2025-01-20T10:30:00Z"
}
```

---

### `GET /api/strategy/history`
Historische plan-nauwkeurigheid (plan vs. werkelijk).

---

## 📊 Anomaliedetectie

Detectie van abnormaal verbruik of hardwarefouten.

### `POST /api/anomalies/detect`
Anomaliedetectie uitvoeren op historische gegevens.

---

### `GET /api/anomalies/summary`
Samenvatting van huidge anomalieën.

---

## 📈 Deviceanalytics

Statistieken en voorspellingen per batterij/apparaat.

### `GET /api/device/stats?device_id=...`
Batterijstatistieken ophalen (laad-/ontlaadduurte, efficiency).

---

### `GET /api/device/forecast?device_id=...`
Batterij-forecastgegevens.

---

## 🏠 Home Assistant Integratie

Verbinding met Home Assistant.

### `GET /api/ha/settings`
Home Assistant-instellingen (URL, token).

---

### `POST /api/ha/settings` 🔒
Home Assistant-verbinding configureren.

**Verzoek:**
```json
{
  "url": "http://homeassistant.local:8123",
  "token": "eyJ..."
}
```

---

### `POST /api/ha/test` 🔒
Home Assistant-verbinding testen.

---

### `GET /api/ha/entities`
Alle Home Assistant-entities ophalen (filters op device_class).

---

### `GET /api/ha/state/<entity_id>`
Huidende staat van Home Assistant-entiteit ophalen.

---

### `POST /api/ha/poll` 🔒
Home Assistant-entiteiten bijwerken (force sync).

---

### `GET /api/ha/consumption-debug` 📍
Debug-endpoint: Home Assistant P1-verbruikscalculatie (HA add-on).

---

## ⚡ SMA Modbus (zonnepanelen)

Rechtstreekse Modbus-communicatie met SMA Sunny Boy.

### `GET /api/sma/live`
Live SMA-data ophalen (vermogen, temperatuur, efficiëntie).

---

### `GET /api/sma/source`
Huidinge bron van SMA-gegevens (live Modbus of HA sensor).

---

### `POST /api/sma/scan` 🔒
Netwerk scannen op SMA Sunny Boy-omvormers.

---

### `GET /api/sma/scan/status`
Status van lopende SMA-scan.

---

### `POST /api/sma/test` 🔒
SMA-verbinding testen.

---

### `GET /api/sma/register-map`
Modbus-registerkaart bekijken.

---

### `PUT /api/sma/register-map` 🔒
Modbus-registerkaart bijwerken.

---

## 📊 InfluxDB-persistentie

Beheer van InfluxDB-dataopslag.

### `GET /api/influx/connection`
InfluxDB-verbinding testen.

---

### `POST /api/influx/connection` 🔒
InfluxDB-verbinding configureren.

**Verzoek:**
```json
{
  "url": "http://localhost:8086",
  "org": "FLUX",
  "bucket": "flux",
  "token": "...",
  "verify_ssl": false
}
```

---

### `POST /api/influx/scan` 🔒
Netwerk scannen op InfluxDB-instanties.

---

### `GET /api/influx/status`
InfluxDB-schrijfstatus (interval, records geschreven).

---

### `GET /api/influx/recent`
Recente punten uit InfluxDB ophalen.

---

### `GET /api/influx/source`
Huidinge InfluxDB-datasource-configuratie.

---

### `POST /api/influx/source` 🔒
InfluxDB-datasource configureren (waar real-time data te vinden).

---

### `GET /api/influx/live-slots`
**Server-Sent Events stream** van InfluxDB-schrijfslots (real-time punten).

---

## 📞 Notificaties

Telegram- en Discord-notificaties.

### `POST /api/telegram/test` 🔒
Testwaarschuwing naar Telegram sturen.

---

### `POST /api/discord/test` 🔒
Testwaarschuwing naar Discord sturen.

---

### `POST /api/telegram/callback`
Telegram-botcallback voor inline-knoppen (goedkeuringen).

---

### `GET /api/telegram/approvals`
Lopende Telegram-goedkeuringen ophalen.

---

## 📈 RTE-calculator

Realtime rendement en efficiëntie.

### `GET /api/rte`
RTE (Round Trip Efficiency) en laadpatronen.

---

## 🔌 Capaciteit & Tariefdynamica

Geavanceerde tariefbeheer.

### `GET /api/cap-tariff/status`
Capaciteitstarief-status.

---

### `GET /api/rolling-cap/status`
Rolling capacity-status.

---

## 💰 Winstoptimalisatie

Geldoptimalisatie-statistieken.

### `GET /api/profit`
Geschatte winst/besparing op basis van laad-/ontlading.

---

## 📡 Automatisering (globaal)

Globale automatisatielogging.

### `GET /api/automation`
Huidige automatisatierun-status (plannen, besluiten).

---

### `POST /api/automation` 🔒
Handmatige automatisering-triggeren (bv. test).

---

## 🔧 Admin & Debug

Interne systeeminformatie en diagnostiek.

### `GET /api/debug`
Debug-informatie (Python-versie, modules, omgevingsvariabelen).

---

### `GET /api/admin/containers`
Docker-container info (ingvallen op production).

---

### `GET /api/debug/esphome-raw`
Rauwe ESPHome SSE-stream diagnostiek.

---

### `GET /api/debug/soc`
State-of-Charge cache-diagnostiek.

---

### `GET /api/claude/usage`
Claude API-gebruik en kosten-tracking.

---

## 🌐 Frontend-routes

### `GET /` (en alle anderen)
Frontend-bestanden serveren (React dist).

---

## 🔗 Grafana-integratie

### `GET /api/grafana-url`
Grafana-dashboardlinks.

---

---

## 🔑 Sleutels & Notatie

| Term | Betekenis |
|------|-----------|
| `<device_id>` | UUID van een ESPHome-batterij of ander apparaat |
| `<user_id>` | Gebruiker-UUID |
| `<entity_id>` | Home Assistant-entiteit (bv. `sensor.power_w`) |
| 🔒 | Vereist admin-rol |
| 📍 | Specifiek voor Home Assistant add-on |
| SSE | Server-Sent Events (real-time push) |
| JWT | JSON Web Token (sessie-token) |
| OAuth2 | Standaard autorisatieprotocol (Daikin, Bosch) |

---

## 📝 Opmerkingen

- **Alle endpoints met `/api/` beginnen** — volledige pad: `http://localhost:5000/api/...`
- **Streaming-endpoints** (`.../stream`, `.../live`, `.../live-slots`) gebruiken **Server-Sent Events**: open voortdurende verbinding.
- **Admin-endpoints** (🔒) vereisen `Authorization: Bearer <JWT-token>` header.
- **Errorresponses** hebben meestal `{"error": "message"}` format en HTTP-statuscode 4xx of 5xx.
- **Authenticatie**: Eerst `POST /api/auth/login`, zet token in `Authorization` header op toekomstige requests.
- **Frank Energie**: NL & BE ondersteund; landen detectie automatisch.
- **HomeWizard**: Ondersteunt API v1 (HTTP) en v2 (HTTPS + token).
- **Daikin & Bosch**: OAuth2-flow: vraag autorisatie-URL, stuur gebruiker naar login, ontvang callback.

