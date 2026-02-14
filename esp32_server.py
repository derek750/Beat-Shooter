"""
FastAPI server for ESP32-WROOM32: connect over USB serial and retrieve button press data.
Run with: uvicorn esp32_server:app --host 0.0.0.0 --port 8001
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import serial
import serial.tools.list_ports
import threading
import re
import json

app = FastAPI(title="ESP32 Button Server")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ESP32 connection state (thread-safe) ---
_serial_lock = threading.Lock()
_serial_conn: Optional[serial.Serial] = None
_connected_port: Optional[str] = None
_baud_rate: int = 115200

# Latest button state: list of 0/1, index = button index. Updated by reader thread.
_buttons: list[int] = []
_buttons_lock = threading.Lock()

# Optional: last N button events (e.g. "PRESS:2", "RELEASE:2") for polling or replay
_max_events = 100
_events: list[dict] = []
_events_lock = threading.Lock()


def _parse_line(line: str) -> Optional[list[int]]:
    """Parse a line from ESP32 into a list of button states (0 or 1)."""
    line = line.strip()
    if not line:
        return None
    # JSON: {"buttons": [0,1,0,0]} or {"b": [0,1,0,0]}
    if line.startswith("{"):
        try:
            data = json.loads(line)
            b = data.get("buttons") or data.get("b")
            if b is not None and isinstance(b, list):
                return [1 if x else 0 for x in b]
        except json.JSONDecodeError:
            pass
        return None
    # Comma-separated digits: 0,1,0,0
    parts = re.findall(r"[01]", line)
    if parts:
        return [int(p) for p in parts]
    return None


def _emit_event(kind: str, index: int):
    with _events_lock:
        _events.append({"type": kind, "button": index})
        if len(_events) > _max_events:
            _events.pop(0)


def _reader_thread():
    """Background thread: read lines from serial and update _buttons (and optionally _events)."""
    global _buttons
    prev: list[int] = []
    while True:
        conn = None
        with _serial_lock:
            conn = _serial_conn
        if conn is None or not conn.is_open:
            break
        try:
            line = conn.readline()
            if not line:
                continue
            try:
                text = line.decode("utf-8", errors="ignore")
            except Exception:
                continue
            parsed = _parse_line(text)
            if parsed is not None:
                with _buttons_lock:
                    _buttons = parsed
                # Emit press/release events by diffing with prev
                for i, v in enumerate(parsed):
                    p = prev[i] if i < len(prev) else 0
                    if v != p:
                        _emit_event("PRESS" if v else "RELEASE", i)
                prev = parsed
        except (serial.SerialException, OSError):
            break
        except Exception:
            continue


_reader: Optional[threading.Thread] = None


# --- Pydantic models ---
class ConnectBody(BaseModel):
    port: str
    baud_rate: int = 115200


# --- Endpoints ---


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/esp32/ports")
def list_ports():
    """List available serial ports (e.g. USB connection to ESP32)."""
    try:
        ports = serial.tools.list_ports.comports()
        out = [
            {
                "device": p.device,
                "description": p.description or "",
                "hwid": p.hwid or "",
            }
            for p in ports
        ]
        return {"success": True, "ports": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/esp32/connect")
def connect(body: ConnectBody):
    """Connect to the ESP32 on the given serial port."""
    global _serial_conn, _connected_port, _baud_rate, _reader
    with _serial_lock:
        if _serial_conn is not None and _serial_conn.is_open:
            return {
                "success": False,
                "detail": f"Already connected to {_connected_port}. Disconnect first.",
            }
        try:
            conn = serial.Serial(
                port=body.port,
                baudrate=body.baud_rate,
                timeout=0.1,
            )
            _serial_conn = conn
            _connected_port = body.port
            _baud_rate = body.baud_rate
        except serial.SerialException as e:
            raise HTTPException(status_code=400, detail=str(e))
    _reader = threading.Thread(target=_reader_thread, daemon=True)
    _reader.start()
    return {
        "success": True,
        "port": body.port,
        "baud_rate": body.baud_rate,
    }


@app.post("/esp32/disconnect")
def disconnect():
    """Disconnect from the ESP32."""
    global _serial_conn, _connected_port, _reader
    with _serial_lock:
        conn = _serial_conn
        _serial_conn = None
        _connected_port = None
    if conn is not None and conn.is_open:
        try:
            conn.close()
        except Exception:
            pass
    return {"success": True, "detail": "Disconnected"}


@app.get("/esp32/status")
def status():
    """Return whether we are connected and to which port."""
    with _serial_lock:
        connected = _serial_conn is not None and _serial_conn.is_open
        port = _connected_port
    return {
        "connected": connected,
        "port": port,
        "baud_rate": _baud_rate if connected else None,
    }


@app.get("/esp32/buttons")
def get_buttons():
    """
    Return the current button state from the ESP32.
    Response: { "buttons": [0,1,0,0], "count": 4 } where 1 = pressed, 0 = released.
    """
    with _buttons_lock:
        buttons = list(_buttons)
    return {"buttons": buttons, "count": len(buttons)}


@app.get("/esp32/events")
def get_events(clear: bool = False):
    """
    Return recent button press/release events.
    Each event: { "type": "PRESS"|"RELEASE", "button": index }.
    If clear=true, events are returned and then cleared.
    """
    with _events_lock:
        out = list(_events)
        if clear:
            _events.clear()
    return {"events": out}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
