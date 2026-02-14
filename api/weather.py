import os
from typing import Optional

from fastapi import APIRouter, HTTPException
import httpx

router = APIRouter(prefix="/api", tags=["weather"])


@router.get("/weather")
async def get_weather(city: str, api_key: Optional[str] = None):
    """Fetch weather data for a city."""
    key = api_key or os.getenv("OPENWEATHER_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="API key not provided")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": city, "appid": key, "units": "metric"},
                timeout=10.0,
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching weather: {str(e)}")
