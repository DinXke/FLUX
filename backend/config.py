"""
Unified configuration abstraction layer for FLUX.

Supports dual-mode deployment:
- HA Addon mode: reads from JSON files (created by setup_config.py from options.json)
- Standalone Docker mode: reads from environment variables

All internal code should use the Config class to access settings, not read JSON files directly.
This abstraction allows swapping config sources without changing application code.
"""
import json
import logging
import os
from functools import lru_cache
from typing import Any, Optional

log = logging.getLogger("config")


class Config:
    """Unified configuration object supporting both HA Addon and Standalone modes."""

    def __init__(self):
        self.data_dir = os.environ.get("MARSTEK_DATA_DIR", "/data")
        self.standalone_mode = os.environ.get("STANDALONE_MODE", "").lower() == "true"
        self._cache = {}

    @property
    def mode(self) -> str:
        """Return 'standalone' or 'ha_addon'."""
        return "standalone" if self.standalone_mode else "ha_addon"

    def _load_json(self, filename: str, defaults: Optional[dict] = None) -> dict:
        """Load JSON file from data directory with optional defaults."""
        path = os.path.join(self.data_dir, filename)
        try:
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            log.warning(f"Failed to load {filename}: {e}")
        return defaults or {}

    def _save_json(self, filename: str, data: dict) -> bool:
        """Save JSON file to data directory."""
        path = os.path.join(self.data_dir, filename)
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            log.error(f"Failed to save {filename}: {e}")
            return False

    # ─────────────────────────────────────────────────────────────────────────
    # Home Assistant Settings
    # ─────────────────────────────────────────────────────────────────────────

    def get_ha_settings(self) -> dict:
        """Get Home Assistant connection settings."""
        if self.standalone_mode:
            # Standalone: use env vars (usually not present)
            return {
                "url": os.environ.get("HA_URL", ""),
                "token": os.environ.get("HA_TOKEN", ""),
            }
        else:
            # HA Addon: read from JSON file created by setup_config.py
            return self._load_json("ha_settings.json", {"url": "", "token": ""})

    def set_ha_settings(self, url: str, token: str) -> bool:
        """Set Home Assistant connection settings."""
        data = {"url": url, "token": token}
        return self._save_json("ha_settings.json", data)

    # ─────────────────────────────────────────────────────────────────────────
    # ENTSO-E Settings
    # ─────────────────────────────────────────────────────────────────────────

    def get_entsoe_settings(self) -> dict:
        """Get ENTSO-E API settings."""
        if self.standalone_mode:
            return {
                "apiKey": os.environ.get("ENTSOE_API_KEY", ""),
                "country": os.environ.get("ENTSOE_COUNTRY", "BE"),
                "timezone": os.environ.get("TIMEZONE", "Europe/Brussels"),
            }
        else:
            return self._load_json("entsoe_settings.json", {
                "apiKey": "",
                "country": "BE",
                "timezone": "Europe/Brussels",
            })

    def set_entsoe_settings(self, api_key: str, country: str, timezone: str) -> bool:
        """Set ENTSO-E API settings."""
        data = {
            "apiKey": api_key,
            "country": country,
            "timezone": timezone,
        }
        return self._save_json("entsoe_settings.json", data)

    # ─────────────────────────────────────────────────────────────────────────
    # InfluxDB Connection Settings
    # ─────────────────────────────────────────────────────────────────────────

    def get_influx_settings(self) -> dict:
        """Get InfluxDB connection settings."""
        if self.standalone_mode:
            return {
                "url": os.environ.get("INFLUX_URL", "http://localhost:8086"),
                "version": "v2",  # Standalone always uses v2
                "username": os.environ.get("INFLUX_USERNAME", ""),
                "password": os.environ.get("INFLUX_PASSWORD", ""),
                "org": os.environ.get("INFLUX_ORG", "smartmarstek"),
                "bucket": os.environ.get("INFLUX_BUCKET", "smartmarstek"),
                "token": os.environ.get("INFLUX_TOKEN", ""),
            }
        else:
            return self._load_json("influx_connection.json", {
                "url": "http://localhost:8086",
                "version": "v1",
                "username": "",
                "password": "",
            })

    def set_influx_settings(self, url: str, version: str, username: str = "", password: str = "") -> bool:
        """Set InfluxDB connection settings."""
        data = {
            "url": url,
            "version": version,
            "username": username,
            "password": password,
        }
        return self._save_json("influx_connection.json", data)

    # ─────────────────────────────────────────────────────────────────────────
    # Strategy Settings (strategy_settings.json)
    # ─────────────────────────────────────────────────────────────────────────

    def get_strategy_settings(self) -> dict:
        """Get strategy engine settings."""
        return self._load_json("strategy_settings.json", {})

    def set_strategy_settings(self, settings: dict) -> bool:
        """Set strategy engine settings."""
        return self._save_json("strategy_settings.json", settings)

    # ─────────────────────────────────────────────────────────────────────────
    # Devices Configuration
    # ─────────────────────────────────────────────────────────────────────────

    def get_devices(self) -> dict:
        """Get registered devices (ESPHome batteries, etc)."""
        return self._load_json("devices.json", {})

    def set_devices(self, devices: dict) -> bool:
        """Set registered devices."""
        return self._save_json("devices.json", devices)

    # ─────────────────────────────────────────────────────────────────────────
    # Logging Configuration
    # ─────────────────────────────────────────────────────────────────────────

    def get_log_level(self) -> str:
        """Get configured log level."""
        if self.standalone_mode:
            return os.environ.get("LOG_LEVEL", "info").lower()
        else:
            # HA Addon might store this in options or env
            return os.environ.get("LOG_LEVEL", "info").lower()

    # ─────────────────────────────────────────────────────────────────────────
    # API Credentials
    # ─────────────────────────────────────────────────────────────────────────

    def get_claude_api_key(self) -> str:
        """Get Claude API key."""
        return os.environ.get("CLAUDE_API_KEY", "")

    def get_openai_api_key(self) -> str:
        """Get OpenAI API key."""
        return os.environ.get("OPENAI_API_KEY", "")

    def get_telegram_config(self) -> dict:
        """Get Telegram bot configuration."""
        return {
            "bot_token": os.environ.get("TELEGRAM_BOT_TOKEN", ""),
            "chat_id": os.environ.get("TELEGRAM_CHAT_ID", ""),
        }

    def get_frank_energie_key(self) -> str:
        """Get Frank Energie API key."""
        return os.environ.get("FRANK_ENERGIE_API_KEY", "")

    def get_daikin_token(self) -> str:
        """Get Daikin OAuth2 token."""
        return os.environ.get("DAIKIN_TOKEN", "")

    def get_bosch_token(self) -> str:
        """Get Bosch Home OAuth2 token."""
        return os.environ.get("BOSCH_TOKEN", "")

    # ─────────────────────────────────────────────────────────────────────────
    # Hardware Configuration (addresses, ports)
    # ─────────────────────────────────────────────────────────────────────────

    def get_sma_config(self) -> dict:
        """Get SMA Sunny Boy Modbus configuration."""
        return {
            "ip": os.environ.get("SMA_IP", "192.168.1.1"),
            "port": int(os.environ.get("SMA_PORT", "502")),
        }

    def get_homewizard_ip(self) -> str:
        """Get HomeWizard local API IP."""
        return os.environ.get("HOMEWIZARD_IP", "")


# Global singleton instance
_config: Optional[Config] = None


def get_config() -> Config:
    """Get or create the global Config instance."""
    global _config
    if _config is None:
        _config = Config()
    return _config


def reset_config() -> None:
    """Reset the global config instance (useful for testing)."""
    global _config
    _config = None
