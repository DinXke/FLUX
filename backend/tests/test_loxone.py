"""
Tests for loxone.py — Loxone Miniserver integration.
Uses unittest.mock to avoid real network calls.
"""
import json
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import loxone as lox


SAMPLE_STRUCTURE = {
    "rooms": {
        "room-1": {"name": "Woonkamer"},
        "room-2": {"name": "Kelder"},
    },
    "controls": {
        "uuid-energy-1": {
            "name": "Energy Socket Woonkamer",
            "type": "EnergySocket",
            "room": "room-1",
        },
        "uuid-light-1": {
            "name": "Verlichting",
            "type": "LightController",
            "room": "room-1",
        },
        "uuid-meter-1": {
            "name": "Energiemeter Kelder",
            "type": "Meter",
            "room": "room-2",
        },
    },
}


class TestLoxoneConfig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_load_defaults_when_file_missing(self):
        cfg = lox.load_loxone_config(self.tmp)
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["host"], "")
        self.assertEqual(cfg["port"], 80)
        self.assertEqual(cfg["poll_interval"], 30)
        self.assertEqual(cfg["selected_entities"], [])

    def test_save_and_reload(self):
        data = {
            "enabled": True,
            "host": "192.168.1.100",
            "port": 80,
            "username": "admin",
            "password": "secret",
            "poll_interval": 30,
            "selected_entities": [{"uuid": "abc", "name": "Meter", "type": "Meter"}],
        }
        ok = lox.save_loxone_config(self.tmp, data)
        self.assertTrue(ok)

        loaded = lox.load_loxone_config(self.tmp)
        self.assertTrue(loaded["enabled"])
        self.assertEqual(loaded["host"], "192.168.1.100")
        self.assertEqual(len(loaded["selected_entities"]), 1)


class TestLoxoneClient(unittest.TestCase):
    def _make_client(self):
        return lox.LoxoneClient("192.168.1.100", 80, "admin", "pass")

    @patch("loxone.requests.get")
    def test_get_api_info(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "LL": {"value": {"version": "12.3.4.5", "snr": "504F94AB1234"}}
        }
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        client = self._make_client()
        info = client.get_api_info()
        self.assertEqual(info["version"], "12.3.4.5")

    @patch("loxone.requests.get")
    def test_get_entity_value_float(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"LL": {"value": "123.45"}}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        client = self._make_client()
        val = client.get_entity_value("some-uuid")
        self.assertAlmostEqual(val, 123.45)

    @patch("loxone.requests.get")
    def test_get_entity_value_none_on_error(self, mock_get):
        mock_get.side_effect = Exception("Connection refused")
        client = self._make_client()
        val = client.get_entity_value("bad-uuid")
        self.assertIsNone(val)

    @patch("loxone.requests.get")
    def test_get_structure_file(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = SAMPLE_STRUCTURE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        client = self._make_client()
        structure = client.get_structure_file()
        self.assertIn("controls", structure)
        self.assertIn("rooms", structure)


class TestDiscoverEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        lox.save_loxone_config(self.tmp, {
            "enabled": True,
            "host": "192.168.1.100",
            "port": 80,
            "username": "admin",
            "password": "pass",
            "poll_interval": 30,
            "selected_entities": [],
        })

    @patch("loxone.requests.get")
    def test_discover_entities(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = SAMPLE_STRUCTURE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        entities = lox.discover_entities(self.tmp)
        self.assertEqual(len(entities), 3)

        energy_ents = [e for e in entities if e["is_energy"]]
        self.assertEqual(len(energy_ents), 2)

        names = {e["name"] for e in entities}
        self.assertIn("Energy Socket Woonkamer", names)
        self.assertIn("Verlichting", names)

    def test_discover_entities_disabled(self):
        lox.save_loxone_config(self.tmp, {"enabled": False, "host": "192.168.1.100"})
        entities = lox.discover_entities(self.tmp)
        self.assertEqual(entities, [])


class TestPollSelectedEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        lox.save_loxone_config(self.tmp, {
            "enabled": True,
            "host": "192.168.1.100",
            "port": 80,
            "username": "admin",
            "password": "pass",
            "poll_interval": 30,
            "selected_entities": [
                {"uuid": "uuid-energy-1", "name": "Energy Socket", "type": "EnergySocket", "room": "Woonkamer"},
                {"uuid": "uuid-meter-1", "name": "Meter Kelder", "type": "Meter", "room": "Kelder"},
            ],
        })

    @patch("loxone.requests.get")
    def test_poll_returns_devices(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"LL": {"value": "250.0"}}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        devices = lox.poll_selected_entities(self.tmp)
        self.assertEqual(len(devices), 2)
        for dev in devices:
            self.assertAlmostEqual(dev.current_power_w, 250.0)

        # Both EnergySocket and Meter types → LoxoneEnergySocket
        energy_devs = [d for d in devices if isinstance(d, lox.LoxoneEnergySocket)]
        self.assertEqual(len(energy_devs), 2)

    def test_poll_disabled(self):
        lox.save_loxone_config(self.tmp, {"enabled": False})
        devices = lox.poll_selected_entities(self.tmp)
        self.assertEqual(devices, [])

    def test_poll_no_selected(self):
        lox.save_loxone_config(self.tmp, {
            "enabled": True, "host": "192.168.1.100", "port": 80,
            "username": "a", "password": "b", "poll_interval": 30,
            "selected_entities": [],
        })
        devices = lox.poll_selected_entities(self.tmp)
        self.assertEqual(devices, [])


class TestConnectionStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_status_disabled(self):
        lox.save_loxone_config(self.tmp, {"enabled": False})
        status = lox.get_connection_status(self.tmp)
        self.assertFalse(status["connected"])
        self.assertFalse(status["enabled"])

    def test_status_no_host(self):
        lox.save_loxone_config(self.tmp, {"enabled": True, "host": ""})
        status = lox.get_connection_status(self.tmp)
        self.assertFalse(status["connected"])
        self.assertIn("error", status)

    @patch("loxone.requests.get")
    def test_status_connected(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"LL": {"value": {"version": "12.0"}}}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        lox.save_loxone_config(self.tmp, {
            "enabled": True, "host": "192.168.1.100", "port": 80,
            "username": "a", "password": "b", "poll_interval": 30,
            "selected_entities": [],
        })
        status = lox.get_connection_status(self.tmp)
        self.assertTrue(status["connected"])
        self.assertIsNone(status["error"])

    @patch("loxone.requests.get")
    def test_status_connection_error(self, mock_get):
        mock_get.side_effect = Exception("Timeout")
        lox.save_loxone_config(self.tmp, {
            "enabled": True, "host": "192.168.1.100", "port": 80,
            "username": "a", "password": "b", "poll_interval": 30,
            "selected_entities": [],
        })
        status = lox.get_connection_status(self.tmp)
        self.assertFalse(status["connected"])
        self.assertIn("Timeout", status["error"])


if __name__ == "__main__":
    unittest.main()
