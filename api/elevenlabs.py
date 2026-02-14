from fastapi import APIRouter, HTTPException
import httpx
import os
from typing import Optional
from elevenlabs import ElevenLabs

router = APIRouter(prefix="/elevenlabs", tags=["eleven"])

ELEVENLABS_KEY = os.getenv("ELEVENLABS_KEY")

client = ElevenLabs(
    api_key=ELEVENLABS_KEY,
    url="https://api.elevenlabs.io/"
)

@router.get("/generatemusic")
async def generate_music_get(prompt: str, duration: int = 30):
    music = client.music.compose(
        prompt=prompt,
        music_length_ms=duration
    )   
    return await music

