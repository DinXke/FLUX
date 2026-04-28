"""
Daikin Onecta OAuth2 integration for heat pump control.
Handles login, token refresh, device discovery, and setpoint control.
"""
import base64
import hashlib
import json
import os
import secrets
import time
import logging
import requests
from datetime import datetime, timedelta
from urllib.parse import urlencode

log = logging.getLogger(__name__)

# Daikin Onecta API endpoints
DAIKIN_AUTH_URL = "https://idp.onecta.daikineurope.com/v1/oauth2/authorize"
DAIKIN_TOKEN_URL = "https://idp.onecta.daikineurope.com/v1/oauth2/token"
DAIKIN_API_URL = "https://api.onecta.daikineurope.com/v1"

# Daikin OAuth2 PKCE public client — register at developer.cloud.daikineurope.com


def _daikin_session_file(data_dir: str) -> str:
    """Return path to daikin_session.json."""
    return os.path.join(data_dir, "daikin_session.json")


def load_daikin_session(data_dir: str) -> dict:
    """Load Daikin OAuth2 session from file."""
    try:
        session_file = _daikin_session_file(data_dir)
        if os.path.exists(session_file):
            with open(session_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        log.warning("Failed to load daikin_session.json: %s", exc)
    return {}


def save_daikin_session(data_dir: str, session: dict) -> None:
    """Save Daikin OAuth2 session to file."""
    session_file = _daikin_session_file(data_dir)
    try:
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session, f, indent=2)
    except Exception as exc:
        log.error("Failed to save daikin_session.json: %s", exc)


def _token_expired(access_token: str, expires_at: float, buffer_sec: int = 60) -> bool:
    """Check if token is expired or expiring soon."""
    if not access_token or not expires_at:
        return True
    return expires_at < (time.time() + buffer_sec)


def _refresh_daikin_token(session: dict, client_id: str) -> dict:
    """Refresh Daikin access token using refresh_token."""
    refresh_token = session.get("refresh_token")
    if not refresh_token:
        raise ValueError("No refresh_token available — login required")

    try:
        log.info("Refreshing Daikin access token")
        resp = requests.post(
            DAIKIN_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
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
        log.info("Daikin token refreshed successfully")
        return session

    except Exception as exc:
        log.error("Failed to refresh Daikin token: %s", exc)
        raise


def ensure_fresh_daikin_token(
    session: dict, data_dir: str, client_id: str
) -> str:
    """Return a valid access token, auto-renewing if expired."""
    access_token = session.get("access_token", "")
    expires_at = session.get("expires_at", 0)

    if not _token_expired(access_token, expires_at):
        return access_token

    log.info("Daikin access token expired — refreshing")
    try:
        session = _refresh_daikin_token(session, client_id)
        save_daikin_session(data_dir, session)
        return session["access_token"]
    except Exception as exc:
        log.error("Token refresh failed: %s", exc)
        raise ValueError(
            "Daikin token verlopen — inloggen vereist via Instellingen > Daikin Onecta"
        )


def daikin_api_request(
    method: str,
    endpoint: str,
    access_token: str,
    json_data: dict = None,
    timeout: int = 10,
) -> dict:
    """Make authenticated request to Daikin API."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    url = f"{DAIKIN_API_URL}{endpoint}"

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
        log.error("Daikin API timeout: %s %s", method, endpoint)
        raise
    except requests.exceptions.HTTPError as e:
        log.error("Daikin API error %s: %s", e.response.status_code, e.response.text)
        raise


def generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


def get_daikin_auth_url(client_id: str, redirect_uri: str, state: str, code_challenge: str) -> str:
    """Build the Daikin Onecta OAuth2 authorization URL."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "scope": "openid",
    }
    return f"{DAIKIN_AUTH_URL}?{urlencode(params)}"


def exchange_daikin_code(
    code: str,
    client_id: str,
    redirect_uri: str,
    code_verifier: str,
    data_dir: str,
) -> dict:
    """Exchange authorization code for tokens and persist session."""
    log.info("Exchanging Daikin authorization code for tokens")
    resp = requests.post(
        DAIKIN_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()

    access_token = body.get("access_token")
    if not access_token:
        raise ValueError(f"Token exchange returned no access_token: {body}")

    session = {
        "access_token": access_token,
        "refresh_token": body.get("refresh_token", ""),
        "expires_at": time.time() + body.get("expires_in", 3600),
        "updated_at": datetime.now().isoformat(),
    }
    save_daikin_session(data_dir, session)
    log.info("Daikin OAuth2 login successful")
    return session


def daikin_logout(data_dir: str) -> None:
    """Logout and remove session file."""
    session_file = _daikin_session_file(data_dir)
    if os.path.exists(session_file):
        try:
            os.remove(session_file)
            log.info("Daikin session removed")
        except Exception as exc:
            log.error("Failed to remove daikin_session.json: %s", exc)


def get_daikin_devices(
    session: dict, data_dir: str, client_id: str
) -> list:
    """
    Fetch list of Daikin heat pump devices.
    Returns list of device dicts with id, name, current_temp, setpoint, power_on, mode.
    """
    access_token = ensure_fresh_daikin_token(session, data_dir, client_id)

    try:
        # List all devices for this user
        devices_resp = daikin_api_request("GET", "/devices", access_token)
        devices = devices_resp.get("data", []) if isinstance(devices_resp, dict) else devices_resp

        result = []
        for dev in devices:
            device_id = dev.get("id")
            name = dev.get("name", "Unknown")

            # Get device state/properties
            try:
                state_resp = daikin_api_request("GET", f"/devices/{device_id}", access_token)
                state = state_resp.get("data", {}) if isinstance(state_resp, dict) else state_resp

                # Extract temperature and setpoint
                climate_control = state.get("climateControl", {})
                indoor_temp = None
                setpoint = None
                power_on = False
                mode = "unknown"

                if isinstance(climate_control, dict):
                    # Navigate nested structure: climateControl -> temperature/setpoint
                    for key, val in climate_control.items():
                        if isinstance(val, dict):
                            if "currentTemperature" in val:
                                indoor_temp = val["currentTemperature"].get("value")
                            if "targetTemperature" in val:
                                setpoint = val["targetTemperature"].get("value")
                            if "onOffMode" in val:
                                power_on = val["onOffMode"].get("value") == "on"
                            if "operationMode" in val:
                                mode = val["operationMode"].get("value", "unknown")

                result.append(
                    {
                        "id": device_id,
                        "name": name,
                        "current_temp": indoor_temp,
                        "setpoint": setpoint,
                        "power_on": power_on,
                        "mode": mode,
                    }
                )

            except Exception as exc:
                log.warning("Failed to get state for device %s: %s", device_id, exc)
                result.append(
                    {
                        "id": device_id,
                        "name": name,
                        "current_temp": None,
                        "setpoint": None,
                        "power_on": None,
                        "mode": "error",
                    }
                )

        return result

    except Exception as exc:
        log.error("Failed to fetch Daikin devices: %s", exc)
        raise


def set_daikin_temperature(
    session: dict,
    data_dir: str,
    client_id: str,
    device_id: str,
    target_celsius: float,
) -> dict:
    """Set temperature setpoint on Daikin device."""
    if not 12 <= target_celsius <= 28:
        raise ValueError(f"Temperature out of range: {target_celsius}°C (12-28°C allowed)")

    access_token = ensure_fresh_daikin_token(session, data_dir, client_id)

    try:
        log.info("Setting Daikin device %s to %.1f°C", device_id, target_celsius)

        # Update target temperature via API
        payload = {
            "targetTemperature": target_celsius,
        }
        result = daikin_api_request(
            "PATCH",
            f"/devices/{device_id}/climateControl/targetTemperature",
            access_token,
            json_data=payload,
        )
        log.info("Daikin setpoint updated: %s", result)
        return {"ok": True, "device_id": device_id, "target_celsius": target_celsius}

    except Exception as exc:
        log.error("Failed to set Daikin temperature: %s", exc)
        raise


def set_daikin_power(
    session: dict,
    data_dir: str,
    client_id: str,
    device_id: str,
    power_on: bool,
) -> dict:
    """Turn Daikin device on or off."""
    access_token = ensure_fresh_daikin_token(session, data_dir, client_id)

    try:
        log.info("Setting Daikin device %s power=%s", device_id, power_on)

        mode = "on" if power_on else "off"
        payload = {"onOffMode": mode}
        result = daikin_api_request(
            "PATCH",
            f"/devices/{device_id}/climateControl/onOffMode",
            access_token,
            json_data=payload,
        )
        log.info("Daikin power updated: %s", result)
        return {"ok": True, "device_id": device_id, "power_on": power_on}

    except Exception as exc:
        log.error("Failed to set Daikin power: %s", exc)
        raise
