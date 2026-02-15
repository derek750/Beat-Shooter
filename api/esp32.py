import json
import re
import threading
import queue
from typing import Optional

import serial
import serial.tools.list_ports
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter(prefix="/esp32", tags=["esp32"])

# ----------------------------
# Serial connection state
# ----------------------------
_serial_lock = threading.Lock()
_serial_conn: Optional[serial.Serial] = None
_connected_port: Optional[str] = None
_baud_rate: int = 115200

_buttons: list[int] = []
_buttons_lock = threading.Lock()
_button_cond = threading.Condition(_buttons_lock)  # condition to wait for button presses

_pitch: float = 0.0
_roll: float = 0.0
_accel_lock = threading.Lock()

_max_events = 200
_events: list[dict] = []
_events_lock = threading.Lock()

_reader: Optional[threading.Thread] = None

# Your fixed device path (macOS style). Change if needed.
CONSTANT_PORT = "/dev/cu.ESP32_Controller"

# ----------------------------
# WebSocket broadcasting
# ----------------------------
_ws_clients: set[WebSocket] = set()
_ws_clients_lock = threading.Lock()

_event_q: "queue.Queue[dict]" = queue.Queue(maxsize=2000)

_broadcaster_started = False
_broadcaster_lock = threading.Lock()


# ----------------------------
# Parse incoming ESP32 lines
# ----------------------------
def _parse_line(line: str) -> Optional[tuple[list[int] | None, float | None, float | None]]:
    line = line.strip()
    if not line:
        return None

    if line.startswith("{"):
        try:
            data = json.loads(line)
            buttons = None
            b = data.get("buttons") or data.get("b")
            if isinstance(b, list):
                buttons = [1 if x else 0 for x in b]

            pitch = data.get("pitch")
            roll = data.get("roll")
            pitch_deg = float(pitch) if pitch is not None else None
            roll_deg = float(roll) if roll is not None else None
            return (buttons, pitch_deg, roll_deg)
        except Exception:
            return None

    parts = re.findall(r"[01]", line)
    if parts:
        return ([int(p) for p in parts], None, None)

    return None


# ----------------------------
# Event push
# ----------------------------
def _push_event(event: dict) -> None:
    with _events_lock:
        _events.append(event)
        if len(_events) > _max_events:
            _events.pop(0)

    try:
        _event_q.put_nowait(event)
    except queue.Full:
        pass


def _emit_button_change(kind: str, index: int) -> None:
    _push_event({"type": kind, "button": index, "buttons": list(_buttons)})


# ----------------------------
# ESP32 reader thread
# ----------------------------
def _reader_thread() -> None:
    global _buttons, _pitch, _roll
    prev: list[int] = []

    while True:
        with _serial_lock:
            conn = _serial_conn

        if conn is None or not conn.is_open:
            break

        try:
            raw = conn.readline()
            if not raw:
                continue

            try:
                text = raw.decode("utf-8", errors="ignore")
            except Exception:
                continue

            parsed = _parse_line(text)
            if parsed is None:
                continue

            buttons, pitch_deg, roll_deg = parsed

            if buttons is not None:
                with _button_cond:
                    _buttons = buttons
                    _button_cond.notify_all()  # wake backend waiters

                for i, v in enumerate(buttons):
                    p = prev[i] if i < len(prev) else 0
                    if v != p:
                        _emit_button_change("PRESS" if v else "RELEASE", i)

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


# ----------------------------
# Backend-driven WebSocket broadcaster
# ----------------------------
async def _broadcaster_loop():
    while True:
        import asyncio
        event = await asyncio.to_thread(_event_q.get)
        msg = json.dumps(event)

        with _ws_clients_lock:
            clients = list(_ws_clients)

        dead: list[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)

        if dead:
            with _ws_clients_lock:
                for ws in dead:
                    _ws_clients.discard(ws)


def _ensure_broadcaster_started() -> None:
    global _broadcaster_started
    with _broadcaster_lock:
        if _broadcaster_started:
            return
        _broadcaster_started = True


def _emit_state_snapshot() -> None:
    with _buttons_lock:
        buttons = list(_buttons)
    _push_event({"type": "STATE", "buttons": buttons})


# ----------------------------
# Backend-driven button helper
# ----------------------------
def backend_press_button(index: int):
    """
    Set button to 1 in backend and push to event queue.
    """
    with _button_cond:
        if len(_buttons) <= index:
            _buttons.extend([0] * (index + 1 - len(_buttons)))
        _buttons[index] = 1
        _button_cond.notify_all()
    _emit_button_change("PRESS", index)


def backend_wait_for_button(index: int, desired: int = 1, timeout: Optional[float] = None) -> bool:
    """
    Wait for a button to reach desired state.
    """
    print("B")
    with _button_cond:
        while len(_buttons) <= index or _buttons[index] != desired:
            if not _button_cond.wait(timeout=timeout):
                return False
        return True


# ----------------------------
# WebSocket endpoint
# ----------------------------
@router.websocket("/ws")
async def ws_events(websocket: WebSocket):
    await websocket.accept()

    _ensure_broadcaster_started()

    start_task = False
    with _broadcaster_lock:
        if not getattr(router, "_ws_broadcast_task_started", False):
            setattr(router, "_ws_broadcast_task_started", True)
            start_task = True

    if start_task:
        import asyncio
        asyncio.create_task(_broadcaster_loop())

    with _ws_clients_lock:
        _ws_clients.add(websocket)

    # Send current backend state once
    _emit_state_snapshot()

    try:
        # Keep connection open, no frontend messages required
        while True:
            await asyncio.sleep(3600)  # sleep indefinitely, or until disconnect
    except WebSocketDisconnect:
        pass
    finally:
        with _ws_clients_lock:
            _ws_clients.discard(websocket)



# ----------------------------
# REST API endpoints
# ----------------------------
class ConnectBody(BaseModel):
    port: str
    baud_rate: int = 115200


@router.get("/ports")
def list_ports():
    try:
        ports = serial.tools.list_ports.comports()
        out = [{"device": p.device, "description": p.description or "", "hwid": p.hwid or ""} for p in ports]
        return {"success": True, "ports": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/connect")
def connect(body: ConnectBody):
    global _serial_conn, _connected_port, _baud_rate, _reader
    with _serial_lock:
        if _serial_conn is not None and _serial_conn.is_open:
            return {"success": False, "detail": f"Already connected to {_connected_port}. Disconnect first."}
        try:
            conn = serial.Serial(port=body.port, baudrate=body.baud_rate, timeout=0.1)
            try:
                conn.reset_input_buffer()
                conn.reset_output_buffer()
            except Exception:
                pass
            _serial_conn = conn
            _connected_port = body.port
            _baud_rate = body.baud_rate
        except serial.SerialException as e:
            raise HTTPException(status_code=400, detail=str(e))

    _reader = threading.Thread(target=_reader_thread, daemon=True)
    _reader.start()
    return {"success": True, "port": body.port, "baud_rate": body.baud_rate}


@router.post("/disconnect")
def disconnect():
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
    with _serial_lock:
        connected = _serial_conn is not None and _serial_conn.is_open
        port = _connected_port
    return {"connected": connected, "port": port, "baud_rate": _baud_rate if connected else None}


@router.get("/buttons")
def get_buttons():
    with _buttons_lock:
        buttons = list(_buttons)
    return {"buttons": buttons, "count": len(buttons)}


@router.post("/buttons")
def click_button(index: int):
    """
    Endpoint to simulate backend button press.
    """
    backend_press_button(index)
    return {"buttons": list(_buttons), "pressed": index}


@router.get("/events")
def get_events(clear: bool = False):
    with _events_lock:
        out = list(_events)
        if clear:
            _events.clear()
    return {"events": out}


@router.get("/accelerometer")
def get_accelerometer():
    with _accel_lock:
        pitch = _pitch
        roll = _roll
    return {"pitch": pitch, "roll": roll}
