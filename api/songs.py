import json
import os
import threading
import uuid
from typing import Optional, List

from fastapi import APIRouter, UploadFile, Form
from pydantic import BaseModel

router = APIRouter(prefix="/songs", tags=["songs"])

_songs_dir = "songs"
_meta_file = os.path.join(_songs_dir, "_meta.json")

os.makedirs(_songs_dir, exist_ok=True)

_max_songs = 200
_meta_lock = threading.Lock()


def _load_meta() -> List[dict]:
    if os.path.isfile(_meta_file):
        try:
            with open(_meta_file, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # Migrate: scan disk for .mp3 files not in meta
    meta = []
    for name in sorted(os.listdir(_songs_dir)):
        if name.endswith(".mp3") and name != "_meta.json":
            song_id = name[:-4]
            meta.append({
                "id": song_id,
                "url": f"/songs/files/{song_id}.mp3",
                "prompt": None,
                "duration_ms": None,
            })
    if meta:
        _save_meta(meta)
    return meta


def _save_meta(meta: List[dict]) -> None:
    with open(_meta_file, "w") as f:
        json.dump(meta, f, indent=2)


def _get_songs_meta() -> List[dict]:
    with _meta_lock:
        meta = _load_meta()
        return list(meta)


class SaveSongBody(BaseModel):
    prompt: Optional[str] = None
    duration_ms: Optional[int] = None


@router.post("/save")
async def save_song(
    file: UploadFile,
    prompt: str = Form(None),
    duration_ms: int = Form(None)
):
    song_id = str(uuid.uuid4())
    file_path = os.path.join(_songs_dir, f"{song_id}.mp3")

    with open(file_path, "wb") as f:
        f.write(await file.read())

    meta_row = {
        "id": song_id,
        "url": f"/songs/files/{song_id}.mp3",
        "prompt": prompt,
        "duration_ms": duration_ms,
    }

    with _meta_lock:
        meta = _load_meta()
        meta.append(meta_row)
        if len(meta) > _max_songs:
            meta = meta[-_max_songs:]
        _save_meta(meta)

    return {"success": True, **meta_row}


@router.get("/list")
def list_songs():
    """List saved songs (metadata only)."""
    return {"songs": _get_songs_meta()}
