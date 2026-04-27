"""
Bosch Home Connect OAuth2 integration for household appliances (washer, dryer, dishwasher, etc.).
Handles login, token refresh, device discovery, and program control.
"""
import json
import os
import time
import logging
import requests
from typing import Optional, Dict, List
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# Bosch Home Connect API endpoints (production)
BOSCH_PROD_AUTH_URL = "https://api.home-connect.com/security/oauth/authorize"
BOSCH_PROD_TOKEN_URL = "https://api.home-connect.com/security/oauth/token"
BOSCH_PROD_API_URL = "https://api.home-connect.com/api"

# Bosch Home Connect sandbox (simulator)
BOSCH_SANDBOX_AUTH_URL = "https://simulator.home-connect.com/security/oauth/authorize"
BOSCH_SANDBOX_TOKEN_URL = "https://simulator.home-connect.com/security/oauth/token"
BOSCH_SANDBOX_API_URL = "https://simulator.home-connect.com/api"


def _get_bosch_urls(sandbox: bool = False) -> tuple:
    """Return OAuth2 and API URLs based on sandbox mode."""
    if sandbox:
        return BOSCH_SANDBOX_AUTH_URL, BOSCH_SANDBOX_TOKEN_URL, BOSCH_SANDBOX_API_URL
    return BOSCH_PROD_AUTH_URL, BOSCH_PROD_TOKEN_URL, BOSCH_PROD_API_URL


def _bosch_session_file(data_dir: str) -> str:
    """Return path to bosch_appliances_session.json."""
    return os.path.join(data_dir, "bosch_appliances_session.json")


def _bosch_settings_file(data_dir: str) -> str:
    """Return path to bosch_appliances_settings.json."""
    return os.path.join(data_dir, "bosch_appliances_settings.json")


def load_bosch_session(data_dir: str) -> dict:
    """Load Bosch OAuth2 session from file."""
    try:
        session_file = _bosch_session_file(data_dir)
        if os.path.exists(session_file):
            with open(session_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        log.warning("Failed to load bosch_appliances_session.json: %s", exc)
    return {}


def save_bosch_session(data_dir: str, session: dict) -> None:
    """Save Bosch OAuth2 session to file."""
    session_file = _bosch_session_file(data_dir)
    try:
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session, f, indent=2)
    except Exception as exc:
        log.error("Failed to save bosch_appliances_session.json: %s", exc)


def load_bosch_settings(data_dir: str) -> dict:
    """Load Bosch appliances settings (programs, priorities, etc.)."""
    try:
        settings_file = _bosch_settings_file(data_dir)
        if os.path.exists(settings_file):
            with open(settings_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        log.warning("Failed to load bosch_appliances_settings.json: %s", exc)
    return {"appliances": {}}


def save_bosch_settings(data_dir: str, settings: dict) -> None:
    """Save Bosch appliances settings."""
    settings_file = _bosch_settings_file(data_dir)
    try:
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    except Exception as exc:
        log.error("Failed to save bosch_appliances_settings.json: %s", exc)


def _token_expired(access_token: str, expires_at: float, buffer_sec: int = 60) -> bool:
    """Check if token is expired or expiring soon."""
    if not access_token or not expires_at:
        return True
    return expires_at < (time.time() + buffer_sec)


def _refresh_bosch_token(
    session: dict, client_id: str, client_secret: str, sandbox: bool = False
) -> dict:
    """Refresh Bosch access token using refresh_token."""
    refresh_token = session.get("refresh_token")
    if not refresh_token:
        raise ValueError("No refresh_token available — login required")

    _, token_url, _ = _get_bosch_urls(sandbox)

    try:
        log.info("Refreshing Bosch access token (sandbox=%s)", sandbox)
        resp = requests.post(
            token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()

        access_token = body.get("access_token")
        refresh_token_new = body.get("refresh_token", refresh_token)
        expires_in = body.get("expires_in", 3600)
        expires_at = time.time() + expires_in

        if not access_token:
            raise ValueError("Token refresh returned no access_token")

        session["access_token"] = access_token
        session["refresh_token"] = refresh_token_new
        session["expires_at"] = expires_at
        session["updated_at"] = datetime.now().isoformat()
        log.info("Bosch token refreshed successfully")
        return session

    except Exception as exc:
        log.error("Failed to refresh Bosch token: %s", exc)
        raise


def ensure_fresh_bosch_token(
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> str:
    """Return a valid access token, auto-renewing if expired."""
    access_token = session.get("access_token", "")
    expires_at = session.get("expires_at", 0)

    if not _token_expired(access_token, expires_at):
        return access_token

    log.info("Bosch access token expired — refreshing")
    try:
        session = _refresh_bosch_token(session, client_id, client_secret, sandbox)
        save_bosch_session(data_dir, session)
        return session["access_token"]
    except Exception as exc:
        log.error("Token refresh failed: %s", exc)
        raise ValueError(
            "Bosch token verlopen — inloggen vereist via Instellingen > Bosch Home Connect"
        )


def bosch_api_request(
    method: str,
    endpoint: str,
    access_token: str,
    json_data: Optional[dict] = None,
    sandbox: bool = False,
    timeout: int = 10,
) -> dict:
    """Make authenticated request to Bosch Home Connect API."""
    _, _, api_url = _get_bosch_urls(sandbox)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    url = f"{api_url}{endpoint}"

    try:
        resp = requests.request(
            method,
            url,
            headers=headers,
            json=json_data,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json() if resp.text else {}
    except requests.exceptions.Timeout:
        log.error("Bosch API timeout: %s %s", method, endpoint)
        raise
    except requests.exceptions.HTTPError as e:
        log.error("Bosch API error %s: %s", e.response.status_code, e.response.text)
        raise


def get_bosch_appliances_auth_url(
    client_id: str, redirect_uri: str, sandbox: bool = False
) -> str:
    """
    Generate Bosch Home Connect OAuth2 authorization URL.
    User should open this URL in browser to authorize.
    """
    auth_url, _, _ = _get_bosch_urls(sandbox)
    return (
        f"{auth_url}"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope=IdentifyDeviceType%20ReadDeviceState%20ControlDeviceState"
    )


def exchange_bosch_appliances_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    data_dir: str,
    sandbox: bool = False,
) -> dict:
    """
    Exchange authorization code for access token + refresh token.
    Called after user authorizes in browser.
    """
    _, token_url, _ = _get_bosch_urls(sandbox)

    try:
        log.info("Exchanging Bosch authorization code")
        resp = requests.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
            },
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()

        access_token = body.get("access_token")
        refresh_token = body.get("refresh_token")
        expires_in = body.get("expires_in", 3600)
        expires_at = time.time() + expires_in

        if not access_token:
            raise ValueError("Code exchange returned no access_token")

        session = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        save_bosch_session(data_dir, session)
        log.info("Bosch authorization successful")
        return {"ok": True, "session": session}

    except Exception as exc:
        log.error("Failed to exchange Bosch code: %s", exc)
        raise


def get_appliances(
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> list:
    """
    Fetch list of Bosch Home Connect appliances.
    Returns list of appliance dicts with id, name, brand, type, state.
    """
    access_token = ensure_fresh_bosch_token(
        session, data_dir, client_id, client_secret, sandbox
    )

    try:
        log.info("Discovering Bosch appliances")
        # Bosch API: GET /homeappliances lists all appliances for authenticated user
        resp = bosch_api_request("GET", "/v1/homeappliances", access_token, sandbox=sandbox)
        appliances = resp.get("data", []) if isinstance(resp, dict) else resp

        result = []
        for app in appliances:
            ha_id = app.get("haId")
            brand = app.get("brand", "Unknown")
            appliance_type = app.get("type", "Unknown")
            name = app.get("name", f"{brand} {appliance_type}")

            # Get appliance state
            try:
                state_resp = bosch_api_request(
                    "GET",
                    f"/v1/homeappliances/{ha_id}/status",
                    access_token,
                    sandbox=sandbox,
                )
                state = state_resp.get("data", {}) if isinstance(state_resp, dict) else state_resp
                # Extract operating state: "IDLE", "RUN", "PAUSE", "STANDBY", etc.
                op_state = state.get("operationState", "UNKNOWN")
            except Exception as exc:
                log.warning("Failed to get state for appliance %s: %s", ha_id, exc)
                op_state = "UNKNOWN"

            result.append(
                {
                    "ha_id": ha_id,
                    "name": name,
                    "brand": brand,
                    "type": appliance_type,
                    "state": op_state,
                }
            )

        return result

    except Exception as exc:
        log.error("Failed to fetch Bosch appliances: %s", exc)
        raise


def get_available_programs(
    ha_id: str,
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> list:
    """
    Get list of available programs for an appliance.
    Returns list of program dicts with key, name, energy_consumption.
    """
    access_token = ensure_fresh_bosch_token(
        session, data_dir, client_id, client_secret, sandbox
    )

    try:
        log.info("Fetching available programs for appliance %s", ha_id)
        # Bosch API: GET /homeappliances/{haId}/programs returns available programs
        resp = bosch_api_request(
            "GET",
            f"/v1/homeappliances/{ha_id}/programs",
            access_token,
            sandbox=sandbox,
        )
        programs = resp.get("data", []) if isinstance(resp, dict) else resp

        result = []
        for prog in programs:
            prog_key = prog.get("key")
            name = prog.get("name", prog_key)
            energy = prog.get("energyConsumption", 0)
            duration = prog.get("duration", 0)

            result.append(
                {
                    "key": prog_key,
                    "name": name,
                    "energy_consumption": energy,
                    "duration_minutes": duration,
                }
            )

        return result

    except Exception as exc:
        log.error("Failed to fetch programs for appliance %s: %s", ha_id, exc)
        raise


def start_appliance_program(
    ha_id: str,
    program_key: str,
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> dict:
    """Start a specific program on an appliance."""
    access_token = ensure_fresh_bosch_token(
        session, data_dir, client_id, client_secret, sandbox
    )

    try:
        log.info("Starting program %s on appliance %s", program_key, ha_id)
        # Bosch API: PUT /homeappliances/{haId}/programs/{programKey}/execute starts the program
        payload = {"data": {}}
        resp = bosch_api_request(
            "PUT",
            f"/v1/homeappliances/{ha_id}/programs/{program_key}/execute",
            access_token,
            json_data=payload,
            sandbox=sandbox,
        )
        log.info("Appliance program started: %s", resp)
        return {"ok": True, "ha_id": ha_id, "program_key": program_key}

    except Exception as exc:
        log.error("Failed to start program on appliance %s: %s", ha_id, exc)
        raise


def stop_appliance(
    ha_id: str,
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> dict:
    """Stop/pause current program on an appliance."""
    access_token = ensure_fresh_bosch_token(
        session, data_dir, client_id, client_secret, sandbox
    )

    try:
        log.info("Stopping appliance %s", ha_id)
        # Bosch API: PUT /homeappliances/{haId}/programs/active/pause pauses the program
        resp = bosch_api_request(
            "PUT",
            f"/v1/homeappliances/{ha_id}/programs/active/pause",
            access_token,
            sandbox=sandbox,
        )
        log.info("Appliance paused: %s", resp)
        return {"ok": True, "ha_id": ha_id}

    except Exception as exc:
        log.error("Failed to stop appliance %s: %s", ha_id, exc)
        raise


def check_bosch_appliances_smart_start(
    solar_surplus_w: float,
    current_price_eur_kwh: Optional[float],
    avg_price_eur_kwh: float,
    session: dict,
    data_dir: str,
    client_id: str,
    client_secret: str,
    sandbox: bool = False,
) -> dict:
    """
    Check if appliances should be started based on solar surplus, negative price, or cheap hours.
    Returns dict with started appliances.

    Args:
        solar_surplus_w: Positive surplus watts (>0 means excess solar)
        current_price_eur_kwh: Current market price in EUR/kWh (can be negative for grid injection)
        avg_price_eur_kwh: 24h average price for comparison
        session: OAuth2 session
        data_dir: Data directory path
        client_id: OAuth2 client ID
        client_secret: OAuth2 client secret
        sandbox: Use simulator mode
    """
    try:
        # Load appliance settings (which appliances to auto-start and their conditions)
        settings = load_bosch_settings(data_dir)
        appliances_cfg = settings.get("appliances", {})

        if not appliances_cfg:
            log.debug("No Bosch appliances configured for smart-start")
            return {"ok": True, "started": []}

        # Determine if conditions are met
        should_start = False
        reason = ""

        # Condition 1: Solar surplus > threshold
        surplus_threshold_w = appliances_cfg.get("solar_surplus_threshold_w", 2000)
        if solar_surplus_w > surplus_threshold_w:
            should_start = True
            reason = f"solar surplus {solar_surplus_w:.0f}W > {surplus_threshold_w}W"

        # Condition 2: Negative price (grid injection)
        if current_price_eur_kwh is not None and current_price_eur_kwh < 0:
            should_start = True
            reason = f"negative price {current_price_eur_kwh:.4f} EUR/kWh"

        # Condition 3: Price is below average
        if (
            not should_start
            and current_price_eur_kwh is not None
            and current_price_eur_kwh < avg_price_eur_kwh * 0.8
        ):
            should_start = True
            reason = f"cheap hour: {current_price_eur_kwh:.4f} EUR/kWh < avg {avg_price_eur_kwh:.4f}"

        if not should_start:
            log.debug("No smart-start condition met for Bosch appliances")
            return {"ok": True, "started": [], "reason": "conditions not met"}

        log.info("Smart-start condition met: %s", reason)

        # Get configured appliances to start
        enabled_appliances = [
            (ha_id, cfg)
            for ha_id, cfg in appliances_cfg.items()
            if cfg.get("enabled") and cfg.get("program_key")
        ]

        if not enabled_appliances:
            log.info("No enabled appliances for smart-start")
            return {"ok": True, "started": [], "reason": "no appliances enabled"}

        started = []
        for ha_id, app_cfg in enabled_appliances:
            program_key = app_cfg.get("program_key")
            try:
                log.info("Smart-start: starting %s with program %s", ha_id, program_key)
                start_appliance_program(
                    ha_id,
                    program_key,
                    session,
                    data_dir,
                    client_id,
                    client_secret,
                    sandbox,
                )
                started.append({"ha_id": ha_id, "program_key": program_key})
            except Exception as exc:
                log.error("Failed to smart-start appliance %s: %s", ha_id, exc)

        return {
            "ok": True,
            "started": started,
            "reason": reason,
            "count": len(started),
        }

    except Exception as exc:
        log.error("Smart-start check failed: %s", exc)
        return {"ok": False, "error": str(exc)}
