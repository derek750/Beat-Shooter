from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from typing import Optional, Dict, Any

app = FastAPI(title="API Proxy Server")

# Enable CORS so React frontend can call this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Example: Fetch data from JSONPlaceholder API
@app.get("/api/posts")
async def get_posts(limit: int = 10):
    """Fetch posts from JSONPlaceholder and return to frontend"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://jsonplaceholder.typicode.com/posts?_limit={limit}",
                timeout=10.0
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching posts: {str(e)}")

# Example: Fetch user data
@app.get("/api/users")
async def get_users():
    """Fetch users from JSONPlaceholder"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://jsonplaceholder.typicode.com/users",
                timeout=10.0
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching users: {str(e)}")

# Example: Fetch weather data (with API key)
@app.get("/api/weather")
async def get_weather(city: str, api_key: Optional[str] = None):
    """Fetch weather data for a city"""
    # Use environment variable or passed API key
    key = api_key or os.getenv("OPENWEATHER_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="API key not provided")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": city, "appid": key, "units": "metric"},
                timeout=10.0
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching weather: {str(e)}")

# Example: Generic proxy endpoint for any API
@app.post("/api/proxy")
async def proxy_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None
):
    """Generic proxy for any external API call"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=10.0
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error making request: {str(e)}")

# Health check endpoint
@app.get("/health")
async def health_check():
    """Check if server is running"""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)