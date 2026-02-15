import atexit
import asyncio
import json
import os
import re
import signal
import threading
import time
from typing import Optional

import serial
import serial.tools.list_ports
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter(prefix="/esp32", tags=["esp32"])

# --- Connection state (thread-safe) ---
_serial_lock = threading.Lock()
_serial_conn: Optional[serial.Serial] = None
_connected_port: Optional[str] = None
_baud_rate: int = 115200

_buttons: list[int] = []
_buttons_lock = threading.Lock()

_pitch: float = 0.0
_roll: float = 0.0
_accel_lock = threading.Lock()

_max_events = 100
_events: list[dict] = []
_events_lock = threading.Lock()

_reader: Optional[threading.Thread] = None

CONSTANT_PORT = "/dev/cu.ESP32_Controller"


def _close_serial_safely(conn: serial.Serial) -> None:
    """Close serial connection with flush and delays. Required for Bluetooth SPP on macOS
    to avoid the port/device getting stuck and requiring forget/re-pair."""
    if conn is None or not conn.is_open:
        return
    try:
        time.sleep(0.15)
        conn.reset_input_buffer()
        conn.reset_output_buffer()
        time.sleep(0.15)
        # Lower DTR/RTS before close - helps Bluetooth SPP release cleanly
        try:
            conn.dtr = False
            conn.rts = False
            time.sleep(0.1)
        except Exception:
            pass
        conn.close()
        time.sleep(0.1)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def _shutdown_serial() -> None:
    """Disconnect and close serial on process exit. Called by atexit and signal handlers."""
    global _serial_conn, _connected_port, _reader
    conn = None
    with _serial_lock:
        conn = _serial_conn
        _serial_conn = None
        _connected_port = None
    if conn is not None:
        _close_serial_safely(conn)


def _parse_line(line: str) -> Optional[tuple[list[int] | None, float | None, float | None]]:
    """Parse a line from ESP32 into (button_states, pitch_deg, roll_deg). Any can be None."""
    line = line.strip()
    if not line:
        return None
    if line.startswith("{"):
        try:
            data = json.loads(line)
            buttons = None
            b = data.get("buttons") or data.get("b")
            if b is not None and isinstance(b, list):
                buttons = [1 if x else 0 for x in b]
            pitch = data.get("pitch")
            roll = data.get("roll")
            pitch_deg = float(pitch) if pitch is not None else None
            roll_deg = float(roll) if roll is not None else None
            return (buttons, pitch_deg, roll_deg)
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
        return None
    parts = re.findall(r"[01]", line)
    if parts:
        return ([int(p) for p in parts], None, None)
    return None


def _emit_event(kind: str, index: int) -> None:
    if index not in (0, 1):
        return
    if kind == "PRESS":
        print(f"Button [{index}] clicked")
    with _events_lock:
        _events.append({"type": kind, "button": index})
        if len(_events) > _max_events:
            _events.pop(0)


def _reader_thread() -> None:
    global _buttons, _pitch, _roll
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
                buttons, pitch_deg, roll_deg = parsed
                if buttons is not None:
                    with _buttons_lock:
                        _buttons = buttons
                    for i, v in enumerate(buttons):
                        p = prev[i] if i < len(prev) else 0
                        if v != p:
                            _emit_event("PRESS" if v else "RELEASE", i)
                    prev = buttons
                if pitch_deg is not None or roll_deg is not None:
                    with _accel_lock:
                        if pitch_deg is not None:
                            _pitch = pitch_deg
                        if roll_deg is not None:
                            _roll = roll_deg
        except (serial.SerialException, OSError):
            break
        except Exception:
            continue


class ConnectBody(BaseModel):
    port: str
    baud_rate: int = 115200

@router.get("/ports")
def list_ports():
    """List available serial ports (e.g. USB connection to ESP32)."""
    try:
        ports = serial.tools.list_ports.comports()
        out = [
            {"device": p.device, "description": p.description or "", "hwid": p.hwid or ""}
            for p in ports
        ]
        return {"success": True, "ports": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/connect")
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
                port=CONSTANT_PORT,
                baudrate=body.baud_rate,
                timeout=0.1,
            )
            _serial_conn = conn
            _connected_port = CONSTANT_PORT
            _baud_rate = body.baud_rate
        except serial.SerialException as e:
            raise HTTPException(status_code=400, detail=str(e))
    _reader = threading.Thread(target=_reader_thread, daemon=True)
    _reader.start()
    return {"success": True, "port": CONSTANT_PORT, "baud_rate": body.baud_rate}


@router.post("/disconnect")
def disconnect():
    """Disconnect from the ESP32."""
    global _serial_conn, _connected_port
    conn = None
    with _serial_lock:
        conn = _serial_conn
        _serial_conn = None
        _connected_port = None
    if conn is not None:
        _close_serial_safely(conn)
    return {"success": True, "detail": "Disconnected"}


@router.get("/status")
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


@router.get("/buttons")
def get_buttons():
    """Current button state: { \"buttons\": [0,1,0,0], \"count\": 4 } (1=pressed, 0=released)."""
    with _buttons_lock:
        buttons = list(_buttons)
    return {"buttons": buttons, "count": len(buttons)}



@router.get("/events")
def get_events(clear: bool = False):
    """Recent button press/release events. Use clear=true to consume and clear."""
    with _events_lock:
        out = list(_events)
        if clear:
            _events.clear()
    return {"events": out}


@router.websocket("/ws")
async def esp32_events_websocket(websocket: WebSocket):
    """Stream ESP32 button press/release events in real time. Sends JSON: { "type": "PRESS"|"RELEASE", "button": index }."""
    await websocket.accept()
    try:
        while True:
            await asyncio.sleep(0.05)
            with _events_lock:
                out = list(_events)
                _events.clear()
            for ev in out:
                try:
                    await websocket.send_json(ev)
                except Exception:
                    return
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@router.get("/accelerometer")
def get_accelerometer():
    """Current orientation from accelerometer: pitch and roll in degrees (tilt)."""
    with _accel_lock:
        pitch = _pitch
        roll = _roll
    return {"pitch": pitch, "roll": roll}


# Ensure Bluetooth serial is properly closed when the server exits (Ctrl+C, kill, etc.).
# Without this, macOS can leave the port in a stuck state requiring forget/re-pair.
atexit.register(_shutdown_serial)


def _signal_handler(signum, frame):
    _shutdown_serial()
    # Restore default handler and re-raise so process exits normally
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)


try:
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)
except (ValueError, OSError):
    # Can happen in non-main thread or unsupported platform
    pass
