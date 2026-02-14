from fastapi import APIRouter
from pydantic import BaseModel
import os
from google import genai

router = APIRouter(prefix="/gemini", tags=["gemini"])

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_KEY)

class GenerateRequest(BaseModel):
    input: str

@router.post("/generate")
async def generate_text(request: GenerateRequest):
    """
    Generate a text completion from a prompt using Gemini AI.
    Returns keywords optimized for ElevenLabs music generation.
    """
    system_prompt = (
        "You are an ElevenLabs song creator. The user will describe the kind of music they want. "
        "Respond with only concise keywords (no sentences) suitable for ElevenLabs music generation, "
        "e.g. 'sad piano arcade music', 'upbeat electronic chiptune', etc. Keep it under 15 words."
    )
    prompt = f"{system_prompt}\n\nUser input: {request.input}"
    response = client.models.generate_content(
        model="gemini-3-flash-preview", 
        contents=prompt
    )
    text = response.text.strip() if response.text else request.input
    return {"response": text}
