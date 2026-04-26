"""
Bosch Home Connect REST API integration for smart thermostat control.
Handles local bridge pairing, device discovery, and heating element control.
"""
import json
import os
import time
import logging
import requests
from typing import Dict, List, Optional

log = logging.getLogger(__name__)


def _bosch_devices_file(data_dir: str) -> str:
    """Return path to bosch_devices.json."""
    return os.path.join(data_dir, "bosch_devices.json")


def load_bosch_devices(data_dir: str) -> dict:
    """Load Bosch device registry from file."""
    try:
        devices_file = _bosch_devices_file(data_dir)
        if os.path.exists(devices_file):
            with open(devices_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        log.warning("Failed to load bosch_devices.json: %s", exc)
    return {}


def save_bosch_devices(data_dir: str, devices: dict) -> None:
    """Save Bosch device registry to file."""
    devices_file = _bosch_devices_file(data_dir)
    try:
        with open(devices_file, "w", encoding="utf-8") as f:
            json.dump(devices, f, indent=2)
    except Exception as exc:
        log.error("Failed to save bosch_devices.json: %s", exc)


def _bosch_request(
    ip: str,
    path: str,
    token: Optional[str] = None,
    method: str = "GET",
    json_data: Optional[dict] = None,
    timeout: int = 5,
) -> dict:
    """
    Make request to Bosch Home Connect bridge.
    Supports both HTTP (v1, no auth) and HTTPS (v2, Bearer token).
    """
    # Try HTTPS first (v2), then HTTP (v1)
    for use_https in [True, False]:
        scheme = "https" if use_https else "http"
        url = f"{scheme}://{ip}{path}"
        headers = {}

        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            resp = requests.request(
                method,
                url,
                headers=headers,
                json=json_data,
                timeout=timeout,
                verify=False if use_https else True,
            )
            resp.raise_for_status()
            return resp.json() if resp.text else {}

        except requests.exceptions.Timeout:
            if not use_https:
                log.warning("Bosch bridge %s timeout", ip)
                raise
            # Try HTTP next
            continue

        except requests.exceptions.ConnectionError:
            if not use_https:
                log.warning("Bosch bridge %s unreachable", ip)
                raise
            # Try HTTP next
            continue

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401 and use_https and not token:
                log.warning("Bosch bridge requires bearer token (v2)")
                raise ValueError("Bridge requires authentication token")
            if not use_https:
                raise
            # Try HTTP next
            continue

        except Exception as exc:
            if not use_https:
                raise
            # Try HTTP next
            log.debug("HTTPS failed, trying HTTP: %s", exc)
            continue

    raise RuntimeError(f"Failed to connect to Bosch bridge at {ip}")


def bosch_probe(ip: str, timeout: int = 5) -> dict:
    """
    Probe a device to detect if it's a Bosch Home Connect bridge.
    Returns bridge info: {model, api_version, serial}
    """
    try:
        # Try v2 API first (HTTPS)
        resp = _bosch_request(ip, "/api/v2/system/info", method="GET", timeout=timeout)
        return {
            "model": resp.get("model", "Unknown"),
            "api_version": "v2",
            "serial": resp.get("serial"),
        }
    except Exception:
        pass

    try:
        # Try v1 API (HTTP, no auth)
        resp = _bosch_request(ip, "/api/v1/system/info", method="GET", timeout=timeout)
        return {
            "model": resp.get("model", "Unknown"),
            "api_version": "v1",
            "serial": resp.get("serial"),
        }
    except Exception as exc:
        log.debug("Bosch probe failed: %s", exc)
        raise


def bosch_pair_v2(ip: str, device_name: str, timeout: int = 30) -> dict:
    """
    Initiate v2 pairing (HTTPS + bearer token).
    User must press physical button on bridge within 30 seconds.
    Returns: {bearer_token, devices}
    """
    try:
        log.info("Initiating Bosch Home Connect v2 pairing at %s", ip)

        # POST to /api/user with device name
        payload = {"username": device_name}
        resp = _bosch_request(ip, "/api/v2/user", method="POST", json_data=payload, timeout=timeout)

        token = resp.get("token")
        if not token:
            raise ValueError("No token returned from pairing request")

        log.info("Bosch pairing successful, token obtained")

        # Discover devices with the new token
        try:
            devices = bosch_discover_devices(ip, token)
        except Exception as exc:
            log.warning("Failed to discover devices after pairing: %s", exc)
            devices = []

        return {"ok": True, "token": token, "devices": devices}

    except Exception as exc:
        log.error("Bosch v2 pairing failed: %s", exc)
        raise


def bosch_discover_devices(ip: str, token: Optional[str] = None) -> list:
    """
    Discover all Bosch Home Connect devices on the bridge.
    Returns list of device dicts with id, name, type, serial.
    """
    try:
        log.info("Discovering Bosch devices at %s", ip)
        resp = _bosch_request(ip, "/api/v2/devices", token=token)
        devices = resp.get("data", []) if isinstance(resp, dict) else resp
        return devices
    except Exception as exc:
        log.error("Failed to discover Bosch devices: %s", exc)
        raise


def bosch_get_thermostat_state(
    ip: str, token: Optional[str], device_id: str
) -> dict:
    """
    Get current thermostat state: current temp, setpoint, mode, power.
    """
    try:
        resp = _bosch_request(ip, f"/api/v2/devices/{device_id}", token=token)
        device_state = resp.get("data", {}) if isinstance(resp, dict) else resp

        # Extract climate control state
        climate_control = device_state.get("climateControl", {})
        current_temp = None
        setpoint = None
        mode = "unknown"
        power_on = True

        if isinstance(climate_control, dict):
            for key, val in climate_control.items():
                if isinstance(val, dict):
                    if "currentTemperature" in val:
                        current_temp = val["currentTemperature"].get("value")
                    if "targetTemperature" in val:
                        setpoint = val["targetTemperature"].get("value")
                    if "operationMode" in val:
                        mode = val["operationMode"].get("value", "unknown")
                    if "onOffMode" in val:
                        power_on = val["onOffMode"].get("value") == "on"

        return {
            "device_id": device_id,
            "current_temp": current_temp,
            "setpoint": setpoint,
            "mode": mode,
            "power_on": power_on,
        }

    except Exception as exc:
        log.error("Failed to get Bosch thermostat state for device %s: %s", device_id, exc)
        raise


def bosch_set_thermostat(
    ip: str,
    token: Optional[str],
    device_id: str,
    target_celsius: float,
) -> dict:
    """Set target temperature on Bosch thermostat."""
    if not 12 <= target_celsius <= 28:
        raise ValueError(f"Temperature out of range: {target_celsius}°C (12-28°C allowed)")

    try:
        log.info("Setting Bosch thermostat %s to %.1f°C", device_id, target_celsius)

        payload = {"targetTemperature": target_celsius}
        resp = _bosch_request(
            ip,
            f"/api/v2/devices/{device_id}/climateControl/targetTemperature",
            token=token,
            method="PATCH",
            json_data=payload,
        )
        log.info("Bosch thermostat setpoint updated")
        return {"ok": True, "device_id": device_id, "target_celsius": target_celsius}

    except Exception as exc:
        log.error("Failed to set Bosch thermostat: %s", exc)
        raise


def bosch_set_power(
    ip: str,
    token: Optional[str],
    device_id: str,
    power_on: bool,
) -> dict:
    """Turn Bosch thermostat on or off."""
    try:
        log.info("Setting Bosch device %s power=%s", device_id, power_on)

        mode = "on" if power_on else "off"
        payload = {"onOffMode": mode}
        resp = _bosch_request(
            ip,
            f"/api/v2/devices/{device_id}/climateControl/onOffMode",
            token=token,
            method="PATCH",
            json_data=payload,
        )
        log.info("Bosch device power updated")
        return {"ok": True, "device_id": device_id, "power_on": power_on}

    except Exception as exc:
        log.error("Failed to set Bosch power: %s", exc)
        raise


def bosch_get_heating_elements(
    ip: str, token: Optional[str], device_id: str
) -> list:
    """
    Get list of heating elements (valves, radiators) for a device.
    Returns list of {id, name, type, position_pct}.
    """
    try:
        resp = _bosch_request(
            ip, f"/api/v2/devices/{device_id}/heatingElements", token=token
        )
        elements = resp.get("data", []) if isinstance(resp, dict) else resp
        return elements
    except Exception as exc:
        log.warning("Failed to get Bosch heating elements: %s", exc)
        return []


def bosch_set_valve_position(
    ip: str,
    token: Optional[str],
    device_id: str,
    valve_id: str,
    position_pct: int,
) -> dict:
    """Set heating element valve position (0-100%)."""
    if not 0 <= position_pct <= 100:
        raise ValueError(f"Valve position out of range: {position_pct}% (0-100 allowed)")

    try:
        log.info(
            "Setting Bosch device %s valve %s to %d%%",
            device_id,
            valve_id,
            position_pct,
        )

        payload = {"valvePosition": position_pct}
        resp = _bosch_request(
            ip,
            f"/api/v2/devices/{device_id}/heatingElements/{valve_id}/valvePosition",
            token=token,
            method="PATCH",
            json_data=payload,
        )
        log.info("Bosch valve position updated")
        return {"ok": True, "device_id": device_id, "valve_id": valve_id, "position_pct": position_pct}

    except Exception as exc:
        log.error("Failed to set Bosch valve position: %s", exc)
        raise
