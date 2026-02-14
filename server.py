from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import health, esp32, elevenlabs


app = FastAPI(title="API Proxy Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(esp32.router)
app.include_router(elevenlabs.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
