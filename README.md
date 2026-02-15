# Beat-Shooter

## Setup

### Backend (from root directory)

#### macOS
1. Create virtual environment: `python3 -m venv venv`
2. Activate virtual environment: `source venv/bin/activate`

#### All Platforms
1. Create `.env` file in the root directory
2. Add the following environment variables to `.env`:
   ```
   ELEVEN_LABS=your_key_here
   GEMINI_API_KEY=your_key_here
   HOST=0.0.0.0
   PORT=8000
   ESP32_SERVER_PORT=8001
   ```
3. Install dependencies: `pip install -r requirements.txt`
4. Start the server: `python3 -m uvicorn server:app --reload`

### Frontend (from frontend directory)

1. Install dependencies: `npm install`
2. Start development server: `npm run dev`

## Environment Variables

Create a `.env` file in the root directory with the following keys:

| Variable | Description |
|----------|-------------|
| `ELEVEN_LABS` | Eleven Labs API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `HOST` | Backend host (default: 0.0.0.0) |
| `PORT` | Backend port (default: 8000) |
| `ESP32_SERVER_PORT` | ESP32 server port (default: 8001) |

## Running the Application

Start both the backend and frontend servers:

1. **Backend**: `python3 -m uvicorn server:app --reload` (from root)
2. **Frontend**: `npm run dev` (from frontend directory)

The application will be available at `http://localhost:5173` (or the port specified by your frontend).