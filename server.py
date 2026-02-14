from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api import health, esp32, elevenlabs, songs, gemini

app = FastAPI(title="API Proxy Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(esp32.router)
app.include_router(elevenlabs.router)
app.include_router(songs.router)
app.include_router(gemini.router)

app.mount("/songs/files", StaticFiles(directory="songs"), name="songs-files")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
