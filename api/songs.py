import os
import threading
import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

router = APIRouter(prefix="/songs", tags=["songs"])

_songs_dir = "songs"
_songs_lock = threading.Lock()

os.makedirs(_songs_dir, exist_ok=True)

_max_songs = 200
_songs_meta: List[dict] = []
_meta_lock = threading.Lock()


class SaveSongBody(BaseModel):
    prompt: Optional[str] = None
    duration_ms: Optional[int] = None


from fastapi import APIRouter, UploadFile, Form

router = APIRouter(prefix="/songs", tags=["songs"])

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
        _songs_meta.append(meta_row)
        if len(_songs_meta) > _max_songs:
            _songs_meta.pop(0)

    return {"success": True, **meta_row}

@router.get("/list")
def list_songs():
    """List saved songs (metadata only)."""
    with _meta_lock:
        return {"songs": list(_songs_meta)}
