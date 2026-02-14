from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import io
import os
from elevenlabs import ElevenLabs

router = APIRouter(prefix="/elevenlabs", tags=["elevenlabs"])

ELEVENLABS_KEY = os.getenv("Eleven_Labs")

client = ElevenLabs(
    api_key=ELEVENLABS_KEY,
)

@router.get("/generatemusic")
async def generate_music(prompt: str, duration: int = 3000):
    audio_stream = client.music.compose(
        prompt=prompt,
        music_length_ms=duration,
        output_format="mp3_22050_32"
    )

    return StreamingResponse(
        audio_stream,
        media_type="audio/mpeg"
    )