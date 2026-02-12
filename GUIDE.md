# AI Human — Architecture & Guide

## Architecture

```
Browser (vanilla HTML/JS/CSS)
    │
    ├── GET /api/characters → list available characters
    │
    └── WebSocket /ws/{character_id}
            │
     FastAPI Backend (backend/main.py)
            │
            └── WebSocket proxy → Gemini Live API
                (wss://generativelanguage.googleapis.com/ws/...BidiGenerateContent)
```

**Approach B: Backend WebSocket Proxy** — browser connects to our FastAPI backend, which proxies all messages to/from Google's Gemini Live API. The API key stays on the server.

### Data Flow
1. User selects a character → browser opens WebSocket to `/ws/{character_id}`
2. Backend loads character config, connects to Gemini, sends setup message (voice, prompt, temperature)
3. After Gemini confirms setup, browser starts streaming:
   - **Microphone audio**: PCM 16-bit, mono, at browser's native sample rate → every ~250ms
   - **Camera frames**: JPEG 768x768 quality 0.5 → every 1 second
4. Gemini streams back audio responses (PCM 24kHz) + optional transcriptions
5. Browser plays audio chunks sequentially through Web Audio API

### File Structure
```
backend/
├── main.py              # FastAPI server: WebSocket proxy + static serving
├── requirements.txt     # fastapi, uvicorn, websockets, python-dotenv
├── .env                 # GOOGLE_API_KEY=your_key_here
└── characters/
    ├── professor.json   # Character config (name, voice, temperature)
    ├── professor.txt    # System prompt
    ├── comedian.json
    └── comedian.txt
frontend/
├── index.html           # Single-page app: character select + conversation
├── app.js               # WebSocket, audio capture/playback, video capture
└── style.css            # Mobile-first CSS
```

## How to Run

```bash
cd backend
pip install -r requirements.txt
# Set your Google API key in .env
uvicorn main:app --host 0.0.0.0 --port 8000
# Open http://localhost:8000
# For mobile: ngrok http 8000 (camera/mic require HTTPS)
```

## How to Add a New Character

1. Create `backend/characters/{id}.json`:
```json
{
    "id": "detective",
    "name": "The Detective",
    "description": "A sharp-eyed investigator who analyzes everything they see",
    "voice": "Charon",
    "temperature": 0.8
}
```

2. Create `backend/characters/{id}.txt` with the system prompt — this controls personality, behavior, and constraints.

3. Restart the server. The new character appears automatically (the API reads all `.json` files from the characters directory).

### Available Voices
Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr (+ ~22 more — see Google docs)

### Key Config Parameters
- **voice**: Gemini voice name (affects tone/personality)
- **temperature**: 0.0-1.0 (lower = focused, higher = creative)

## Model
`gemini-2.5-flash-native-audio-preview-12-2025` via Gemini Live API — single model handles speech recognition, visual understanding, reasoning, and voice generation natively.

## Next Steps
- Add new characters (just add .json + .txt files)
- Deploy to production (needs HTTPS for camera/mic access)
