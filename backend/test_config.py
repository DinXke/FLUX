#!/usr/bin/env python3
"""
Test the config abstraction layer in both HA Addon and Standalone modes.
"""
import json
import os
import tempfile
import pytest
from config import Config, reset_config


@pytest.fixture
def temp_data_dir():
    """Create a temporary data directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["MARSTEK_DATA_DIR"] = tmpdir
        reset_config()
        yield tmpdir
        reset_config()


def test_config_ha_addon_mode(temp_data_dir):
    """Test HA Addon mode: reads from JSON files."""
    os.environ.pop("STANDALONE_MODE", None)
    config = Config()
    assert config.mode == "ha_addon"
    assert not config.standalone_mode

    # Initially no settings
    assert config.get_ha_settings() == {"url": "", "token": ""}

    # Save and reload
    config.set_ha_settings("http://homeassistant:8123", "token123")
    ha_settings = config.get_ha_settings()
    assert ha_settings["url"] == "http://homeassistant:8123"
    assert ha_settings["token"] == "token123"

    # Verify file was written
    path = os.path.join(temp_data_dir, "ha_settings.json")
    assert os.path.exists(path)


def test_config_standalone_mode(temp_data_dir):
    """Test Standalone Docker mode: reads from environment variables."""
    os.environ["STANDALONE_MODE"] = "true"
    os.environ["ENTSOE_API_KEY"] = "test_key"
    os.environ["ENTSOE_COUNTRY"] = "NL"
    os.environ["TIMEZONE"] = "Europe/Amsterdam"

    reset_config()
    config = Config()
    assert config.mode == "standalone"
    assert config.standalone_mode

    # Should read from env vars
    entsoe = config.get_entsoe_settings()
    assert entsoe["apiKey"] == "test_key"
    assert entsoe["country"] == "NL"
    assert entsoe["timezone"] == "Europe/Amsterdam"

    # Cleanup
    os.environ.pop("STANDALONE_MODE", None)
    os.environ.pop("ENTSOE_API_KEY", None)
    os.environ.pop("ENTSOE_COUNTRY", None)
    os.environ.pop("TIMEZONE", None)


def test_config_entsoe_settings(temp_data_dir):
    """Test ENTSO-E settings persistence."""
    os.environ.pop("STANDALONE_MODE", None)
    config = Config()

    config.set_entsoe_settings("my_key", "BE", "Europe/Brussels")
    settings = config.get_entsoe_settings()

    assert settings["apiKey"] == "my_key"
    assert settings["country"] == "BE"
    assert settings["timezone"] == "Europe/Brussels"

    # Verify file persistence
    path = os.path.join(temp_data_dir, "entsoe_settings.json")
    with open(path) as f:
        data = json.load(f)
    assert data["apiKey"] == "my_key"


def test_config_influx_settings(temp_data_dir):
    """Test InfluxDB settings persistence."""
    os.environ.pop("STANDALONE_MODE", None)
    config = Config()

    config.set_influx_settings("http://localhost:8086", "v2", "admin", "pass")
    settings = config.get_influx_settings()

    assert settings["url"] == "http://localhost:8086"
    assert settings["version"] == "v2"
    assert settings["username"] == "admin"
    assert settings["password"] == "pass"


def test_config_influx_standalone(temp_data_dir):
    """Test InfluxDB settings in Standalone mode: reads from env vars."""
    os.environ["STANDALONE_MODE"] = "true"
    os.environ["INFLUX_URL"] = "http://influxdb:8086"
    os.environ["INFLUX_USERNAME"] = "influx_user"
    os.environ["INFLUX_PASSWORD"] = "influx_pass"
    os.environ["INFLUX_ORG"] = "myorg"
    os.environ["INFLUX_BUCKET"] = "mybucket"

    reset_config()
    config = Config()
    settings = config.get_influx_settings()

    assert settings["url"] == "http://influxdb:8086"
    assert settings["username"] == "influx_user"
    assert settings["password"] == "influx_pass"
    assert settings["org"] == "myorg"
    assert settings["bucket"] == "mybucket"
    assert settings["version"] == "v2"

    # Cleanup
    os.environ.pop("STANDALONE_MODE", None)
    os.environ.pop("INFLUX_URL", None)
    os.environ.pop("INFLUX_USERNAME", None)
    os.environ.pop("INFLUX_PASSWORD", None)
    os.environ.pop("INFLUX_ORG", None)
    os.environ.pop("INFLUX_BUCKET", None)


def test_config_devices_persistence(temp_data_dir):
    """Test devices configuration persistence."""
    os.environ.pop("STANDALONE_MODE", None)
    config = Config()

    devices = {
        "battery1": {"name": "Marstek Battery", "ip": "192.168.1.100", "port": 8080}
    }
    config.set_devices(devices)
    loaded = config.get_devices()

    assert loaded == devices


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
