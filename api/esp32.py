import json
import re
import threading
import asyncio
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

# ----------------------------
# WebSocket broadcast plumbing
# ----------------------------
_ws_clients: set[WebSocket] = set()
_ws_lock = threading.Lock()
_ws_loop: Optional[asyncio.AbstractEventLoop] = None


def _parse_line(line: str) -> Optional[tuple[list[int] | None, float | None, float | None]]:
    """Parse a line from ESP32 into (button_states, pitch_deg, roll_deg). Any can be None."""
    line = line.strip()
    if not line:
        return None

    # JSON line
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
            return None

    # fallback: parse any 0/1 chars
    parts = re.findall(r"[01]", line)
    if parts:
        return ([int(p) for p in parts], None, None)

    return None


async def _broadcast_event(event: dict) -> None:
    # snapshot clients
    with _ws_lock:
        clients = list(_ws_clients)

    if not clients:
        return

    dead: list[WebSocket] = []
    msg = json.dumps(event)

    for ws in clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)

    if dead:
        with _ws_lock:
            for ws in dead:
                _ws_clients.discard(ws)


def _schedule_broadcast(event: dict) -> None:
    # called from serial reader thread -> schedule into event loop thread-safely
    global _ws_loop
    loop = _ws_loop
    if loop is None:
        return

    def _runner():
        asyncio.create_task(_broadcast_event(event))

    try:
        loop.call_soon_threadsafe(_runner)
    except Exception:
        pass


def _emit_event(kind: str, index: int) -> None:
    event = {"type": kind, "button": index}

    with _events_lock:
        _events.append(event)
        if len(_events) > _max_events:
            _events.pop(0)

    # push to websocket listeners immediately
    _schedule_broadcast(event)


def _reader_thread() -> None:
    global _buttons, _pitch, _roll
    prev: list[int] = []

    while True:
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
            if parsed is None:
                continue

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


@router.websocket("/ws")
async def ws_events(websocket: WebSocket):
    """
    WebSocket stream of button events:
    { "type": "PRESS" | "RELEASE", "button": <int> }
    """
    global _ws_loop
    await websocket.accept()

    # store loop for thread-safe scheduling from serial reader thread
    try:
        _ws_loop = asyncio.get_running_loop()
    except Exception:
        _ws_loop = None

    with _ws_lock:
        _ws_clients.add(websocket)

    # optionally send current state once on connect
    try:
        with _buttons_lock:
            current = list(_buttons)
        await websocket.send_text(json.dumps({"type": "STATE", "buttons": current}))
    except Exception:
        pass

    try:
        while True:
            # keep alive; client can send anything or nothing
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        with _ws_lock:
            _ws_clients.discard(websocket)


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
                port=CONSTANT_PORT,      # you force your constant port here
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
    """Current button state: { "buttons": [0,1,0,0], "count": 4 } (1=pressed, 0=released)."""
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


@router.get("/accelerometer")
def get_accelerometer():
    """Current orientation from accelerometer: pitch and roll in degrees (tilt)."""
    with _accel_lock:
        pitch = _pitch
        roll = _roll
    return {"pitch": pitch, "roll": roll}
