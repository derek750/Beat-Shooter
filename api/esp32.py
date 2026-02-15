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

# Thread-safe queue from serial thread -> async websocket broadcaster
_event_q: "queue.Queue[dict]" = queue.Queue(maxsize=2000)

# Ensure broadcaster starts only once
_broadcaster_started = False
_broadcaster_lock = threading.Lock()


def _parse_line(line: str) -> Optional[tuple[list[int] | None, float | None, float | None]]:
    """
    Parse a line from ESP32 into (button_states, pitch_deg, roll_deg). Any can be None.

    Accepts either:
    - JSON: {"buttons":[0,1,0], "pitch": 12.3, "roll": -4.5}
    - Raw: "0101" or "0 1 0 1" (extracts 0/1 chars)
    """
    line = line.strip()
    if not line:
        return None

    # JSON
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

    # Non-JSON: extract any 0/1 chars
    parts = re.findall(r"[01]", line)
    if parts:
        return ([int(p) for p in parts], None, None)

    return None


def _push_event(event: dict) -> None:
    """
    Called from any thread. Adds to in-memory history and to websocket queue.
    """
    with _events_lock:
        _events.append(event)
        if len(_events) > _max_events:
            _events.pop(0)

    # push to websocket queue (non-blocking best-effort)
    try:
        _event_q.put_nowait(event)
    except queue.Full:
        # drop if overloaded
        pass


def _emit_button_change(kind: str, index: int) -> None:
    _push_event({"type": kind, "button": index})


def _reader_thread() -> None:
    """
    Reads serial lines forever until disconnect or error.
    Emits PRESS/RELEASE events based on edge changes.
    Updates button state + pitch/roll.
    """
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
                with _buttons_lock:
                    _buttons = buttons

                # edge detect
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
# Background broadcaster (async)
# ----------------------------
async def _broadcaster_loop() -> None:
    """
    Runs forever. Pulls events from thread-safe queue and broadcasts to all WS clients.
    """
    while True:
        # NOTE: queue.Queue.get() is blocking and not awaitable.
        # We do it in a threadpool-ish way by using asyncio.to_thread.
        import asyncio

        event = await asyncio.to_thread(_event_q.get)
        msg = json.dumps(event)

        with _ws_clients_lock:
            clients = list(_ws_clients)

        if not clients:
            continue

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
    """
    Called from sync context; schedules the broadcaster on first WS connect.
    """
    global _broadcaster_started
    with _broadcaster_lock:
        if _broadcaster_started:
            return
        _broadcaster_started = True

    # We can't "await" here; broadcaster will be started inside ws endpoint
    # (we’ll do it there when we have an event loop).


class ConnectBody(BaseModel):
    port: str
    baud_rate: int = 115200


@router.websocket("/ws")
async def ws_events(websocket: WebSocket):
    """
    WebSocket stream:
      - STATE snapshot on connect: {"type":"STATE","buttons":[...]}
      - Edge events: {"type":"PRESS"/"RELEASE","button":i}
    """
    await websocket.accept()

    # Start broadcaster task ONCE (now that we are in an async event loop)
    _ensure_broadcaster_started()
    # Only the first connected client will actually start the task.
    # If task already started, creating another would be wasteful, so guard:
    # We'll detect by checking if queue consumer is running via a private flag.
    # Simplest: start it when first client connects and ignore subsequent.
    # We do that here by using another guard with the same lock.
    start_task = False
    with _broadcaster_lock:
        # if started flag is true we still don't know if task launched;
        # launch exactly once by attaching an attribute on router.
        if not getattr(router, "_ws_broadcast_task_started", False):
            setattr(router, "_ws_broadcast_task_started", True)
            start_task = True

    if start_task:
        import asyncio

        asyncio.create_task(_broadcaster_loop())

    with _ws_clients_lock:
        _ws_clients.add(websocket)

    # Send current button state immediately
    try:
        with _buttons_lock:
            current = list(_buttons)
        await websocket.send_text(json.dumps({"type": "STATE", "buttons": current}))
    except Exception:
        pass

    try:
        # We don't require client messages.
        # Just keep the socket open until disconnect.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        with _ws_clients_lock:
            _ws_clients.discard(websocket)


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
    """
    Connects to ESP32.
    NOTE: You were passing port in body, but using CONSTANT_PORT anyway.
    We'll keep your behavior: always use CONSTANT_PORT.
    """
    global _serial_conn, _connected_port, _baud_rate, _reader

    with _serial_lock:
        if _serial_conn is not None and _serial_conn.is_open:
            return {"success": False, "detail": f"Already connected to {_connected_port}. Disconnect first."}

        try:
            conn = serial.Serial(
                port=CONSTANT_PORT,
                baudrate=body.baud_rate,
                timeout=0.1,
            )
            # clear stale bytes
            try:
                conn.reset_input_buffer()
                conn.reset_output_buffer()
            except Exception:
                pass

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
