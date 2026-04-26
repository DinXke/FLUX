#!/usr/bin/env python3
"""
Mock ESPHome HTTP server for FLUX SCH-772 testing.

Serves:
  GET /         -> 200 OK (reachability check)
  GET /events   -> SSE stream: state events, then keeps alive with heartbeats
  POST /select/*  -> 200 OK (command accept)
  POST /number/*  -> 200 OK (command accept)

Run: python3 /tmp/mock_esphome.py [--port 18080]
"""
import argparse
import json
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Threaded HTTP server so SSE connections don't block command POSTs."""
    daemon_threads = True

STATE_EVENTS = [
    {"id": "sensor-battery_soc", "state": "72.5 %", "value": 72.5},
    {"id": "sensor-battery_power_w", "state": "1200.0 W", "value": 1200.0},
    {"id": "sensor-inverter_state", "state": "Charge"},
    {"id": "sensor-pv_power_w", "state": "2400.0 W", "value": 2400.0},
]

# When True, the /events endpoint closes after the initial burst (simulates disconnect)
_simulate_disconnect = threading.Event()
_reconnect_ok = threading.Event()
_reconnect_ok.set()  # by default, connections are accepted


class ESPHomeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[mock-esphome] {self.address_string()} {fmt % args}", flush=True)

    def do_GET(self):
        if self.path == "/":
            body = b'{"name":"mock-marstek","friendly_name":"Mock Marstek Battery"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                # Send initial state events
                for ev in STATE_EVENTS:
                    chunk = f"event: state\ndata: {json.dumps(ev)}\n\n"
                    self.wfile.write(chunk.encode())
                    self.wfile.flush()
                    time.sleep(0.02)

                if _simulate_disconnect.is_set():
                    # Simulate device closing connection (RST / ConnectionResetError)
                    print("[mock-esphome] simulating disconnect", flush=True)
                    return  # close connection without ping

                # Stay alive with periodic heartbeat pings (like real ESPHome)
                count = 0
                while count < 30:  # up to 30 pings = ~30 seconds keep-alive
                    time.sleep(1)
                    self.wfile.write(b"event: ping\ndata: {}\n\n")
                    self.wfile.flush()
                    count += 1
                    if _simulate_disconnect.is_set():
                        print("[mock-esphome] disconnecting mid-stream", flush=True)
                        return
            except (BrokenPipeError, ConnectionResetError) as exc:
                print(f"[mock-esphome] client disconnected: {exc}", flush=True)

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        """Accept ESPHome commands (select/number set)."""
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(port: int):
    server = ThreadedHTTPServer(("0.0.0.0", port), ESPHomeHandler)
    server.timeout = 1  # allow checking for shutdown
    print(f"[mock-esphome] listening on :{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[mock-esphome] shutting down", flush=True)
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18080)
    args = parser.parse_args()
    run(args.port)
