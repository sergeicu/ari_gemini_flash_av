# AI Human — Architecture & Research Document

## 1. Executive Summary

**AI Human** is a mobile-first webapp that acts as an AI character — it can **see** (via phone camera), **hear** (via microphone), and **speak** (via generated voice) in real-time. Users point their phone at people or objects and the AI engages in natural conversation about what it sees. Multiple character instances can run with different personality prompts.

**Key finding: Google's Gemini Live API with Native Audio can do ALL of this with a single model — no ElevenLabs needed.** One model handles speech recognition, visual understanding, reasoning, and voice generation natively.

---

## 2. Model Research & Selection

### 2.1 Recommended Model

| Property | Value |
|----------|-------|
| **Model** | `gemini-2.5-flash-native-audio-preview-12-2025` |
| **API** | Gemini Live API (WebSocket-based, bidirectional streaming) |
| **Input modalities** | Audio (16kHz PCM) + Video (camera frames) + Text |
| **Output modalities** | Audio (24kHz PCM, native voice) + Text transcription |
| **Latency** | Sub-second (native audio, no STT→LLM→TTS pipeline) |
| **Voices** | 30 HD voices in 24 languages (Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr, and more) |

### 2.2 Why This Model

The Gemini 2.5 Flash Native Audio model is a **single unified model** that replaces the traditional three-stage pipeline:

```
TRADITIONAL (high latency):    STT → LLM → TTS
GEMINI NATIVE AUDIO (low):     [Raw Audio + Video] → Single Model → [Native Speech Output]
```

**Critical capabilities for AI Human:**

- **Native audio processing**: The model processes raw audio waveforms directly — no transcription step. This means it can understand tone, emotion, pace, and respond naturally.
- **Real-time video understanding**: Camera frames are streamed alongside audio. The model can identify objects, read text, recognize scenes, and discuss what it sees.
- **Affective dialog**: The model detects the user's emotional state from voice and adjusts its response tone accordingly.
- **Voice Activity Detection (VAD)**: Built-in interruption handling — users can interrupt mid-sentence, and the model stops and responds to the new input.
- **Proactive Audio** (preview): The model can decide NOT to respond when audio isn't directed at it — useful for a "wandering AI" that only speaks when spoken to.
- **Thinking**: Supports configurable thinking budgets for more reasoned responses.
- **System instructions**: Fully customizable personality via system prompt.

### 2.3 Alternative Models Considered

| Model | Verdict |
|-------|---------|
| **OpenAI Realtime API (GPT-4o)** | Supports audio in/out via WebRTC, but no native video input. Would need separate vision pipeline. |
| **ElevenLabs + separate LLM** | Three-service pipeline (ElevenLabs TTS + Whisper STT + vision LLM). Higher latency, more complexity, more cost. |
| **Gemini 2.0 Flash (non-native audio)** | Older, uses half-cascade (text→TTS). Higher latency, less natural voice. |
| **Gemini 3 Flash** | Newer model but Native Audio variant not yet confirmed for Live API. Check availability. |

**Verdict**: Gemini 2.5 Flash Native Audio via Live API is the clear winner — single model, lowest latency, native multimodal.

### 2.4 Available Voices for Character Selection

Each AI Human character can use a different voice. Current confirmed voices:
- **Puck** — Energetic, youthful
- **Charon** — Deep, authoritative
- **Kore** — Warm, friendly
- **Fenrir** — Strong, commanding
- **Aoede** — Musical, expressive
- **Leda** — Calm, professional
- **Orus** — Rich, resonant
- **Zephyr** — Light, breezy

Plus ~22 additional HD voices available (check Google docs for full list).

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MOBILE BROWSER (PWA)                      │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐ │
│  │  Camera  │  │   Mic    │  │  Audio     │  │  Character│ │
│  │  Stream  │  │  Stream  │  │  Playback  │  │  UI       │ │
│  └────┬─────┘  └────┬─────┘  └─────▲──────┘  └───────────┘ │
│       │              │              │                        │
│       └──────┬───────┘              │                        │
│              ▼                      │                        │
│     ┌────────────────┐    ┌────────┴────────┐              │
│     │  MediaStream   │    │  AudioContext    │              │
│     │  Capture &     │    │  PCM Playback   │              │
│     │  Frame Extract │    │  (24kHz 16-bit) │              │
│     └───────┬────────┘    └────────▲────────┘              │
│             │                      │                        │
│             ▼                      │                        │
│     ┌──────────────────────────────┴──────┐                │
│     │         WebSocket Client            │                │
│     │   (sends audio+video, receives      │                │
│     │    audio+text via ephemeral token)   │                │
│     └──────────────────┬──────────────────┘                │
└────────────────────────┼────────────────────────────────────┘
                         │ WSS (ephemeral token auth)
                         ▼
┌────────────────────────────────────────────────────────────┐
│                  LIGHTWEIGHT BACKEND                        │
│                  (Python FastAPI on Cloud Run)              │
│                                                            │
│  ┌──────────────────┐   ┌──────────────────────────┐      │
│  │  /api/token      │   │  /api/characters         │      │
│  │  Ephemeral Token │   │  Returns character config │      │
│  │  Generation      │   │  (system prompt, voice,   │      │
│  │  (short-lived,   │   │   model params)           │      │
│  │   locked config) │   │                            │      │
│  └──────────────────┘   └──────────────────────────┘      │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │  Character Prompt Files                           │     │
│  │  /characters/character_1.txt                      │     │
│  │  /characters/character_2.txt                      │     │
│  │  (system instructions loaded per character)       │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
                         │
                         │ Creates ephemeral tokens via
                         ▼
┌────────────────────────────────────────────────────────────┐
│              GOOGLE GEMINI LIVE API                         │
│              (WebSocket endpoint)                           │
│                                                            │
│  wss://generativelanguage.googleapis.com/ws/               │
│     google.ai.generativelanguage.v1alpha.                  │
│     GenerativeService.BidiGenerateContent                  │
│                                                            │
│  Model: gemini-2.5-flash-native-audio-preview-12-2025     │
│  Session: stateful, bidirectional, up to 30 min            │
│  Input: audio (16kHz PCM) + video frames (JPEG)           │
│  Output: audio (24kHz PCM) + text transcripts             │
└────────────────────────────────────────────────────────────┘
```

### 3.1 Two Deployment Approaches

**Option A: Client-to-Server (Recommended for lowest latency)**
```
Phone Browser ──WebSocket──► Gemini Live API
       ▲
       │ ephemeral token
Phone Browser ──HTTPS──► Your Backend (token endpoint only)
```
- Browser connects DIRECTLY to Gemini via WebSocket
- Backend only issues ephemeral tokens (no media proxying)
- Lowest possible latency
- System instructions locked into the ephemeral token for security

**Option B: Server-to-Server (Better security, slightly higher latency)**
```
Phone Browser ──WebSocket──► Your Backend ──WebSocket──► Gemini Live API
```
- All media flows through your backend
- Full control over logging, rate limiting, business logic
- Adds ~50-100ms latency per hop

**Recommendation: Option A** for the AI Human use case. Latency is critical for natural conversation, and ephemeral tokens with locked configurations provide adequate security.

---

## 4. Component Specifications

### 4.1 Frontend — Mobile PWA (React + TypeScript)

**Tech stack:**
- React (TypeScript)
- Progressive Web App (installable, works offline for UI)
- Web Audio API for PCM capture/playback
- MediaDevices API for camera access
- Native WebSocket for Gemini connection

**Key modules:**

| Module | Responsibility |
|--------|----------------|
| `AudioCapture` | getUserMedia → PCM 16-bit 16kHz → base64 chunks → WebSocket |
| `VideoCapture` | getUserMedia (rear camera) → canvas → JPEG frames at 1 FPS → WebSocket |
| `AudioPlayback` | Receive base64 PCM → AudioContext → speaker output at 24kHz |
| `WebSocketClient` | Manages connection to Gemini, handles setup message, send/receive |
| `CharacterSelector` | UI to pick which AI character to activate |
| `ConversationLog` | Optional: shows text transcripts of both sides |

**Video frame rate**: The Gemini Live API samples video at ~1 frame per second (258 tokens/second for video input). Sending more frames wastes tokens. Capture at 1 FPS.

**Audio format**: Raw PCM, 16-bit little-endian, mono, 16kHz sample rate for input. Output is 24kHz.

**Critical browser considerations:**
- `getUserMedia` requires HTTPS (use ngrok for local dev)
- iOS Safari has restrictions on autoplay audio — require user gesture to start
- Echo cancellation: users should wear headphones, or implement echo cancellation
- Screen must stay awake — use Wake Lock API

### 4.2 Backend — Python FastAPI

**Minimal responsibilities (Option A architecture):**

```python
# Endpoints needed:
POST /api/token/{character_id}    → Returns ephemeral token with locked config
GET  /api/characters              → Lists available characters
GET  /api/characters/{id}         → Returns character metadata (name, description, avatar)
```

**Ephemeral token generation:**

```python
from google import genai

client = genai.Client(http_options={'api_version': 'v1alpha'})

def create_token(character_id: str):
    prompt = load_character_prompt(character_id)  # Read from file
    voice = load_character_voice(character_id)     # e.g., "Puck"

    token = client.auth_tokens.create(
        config={
            'uses': 1,  # Single session per token
            'expire_time': now + timedelta(minutes=30),
            'new_session_expire_time': now + timedelta(minutes=2),
            'live_connect_constraints': {
                'model': 'gemini-2.5-flash-native-audio-preview-12-2025',
                'config': {
                    'system_instruction': prompt,
                    'response_modalities': ['AUDIO'],
                    'speech_config': {'voice_config': {'prebuilt_voice_config': {'voice_name': voice}}},
                    'session_resumption': {},
                    'temperature': 0.8,
                }
            },
            'http_options': {'api_version': 'v1alpha'},
        }
    )
    return token.name  # Send this to the client
```

**Character prompt files:**

```
/characters/
├── professor.txt          # "You are Professor Oak, a warm, knowledgeable..."
├── professor.json         # { "voice": "Orus", "temperature": 0.7 }
├── comedian.txt           # "You are a witty stand-up comedian who..."  
└── comedian.json          # { "voice": "Puck", "temperature": 0.9 }
```

### 4.3 Character Configuration Schema

```json
{
  "id": "professor",
  "name": "The Professor",
  "description": "A warm, knowledgeable guide who loves explaining what they see",
  "voice": "Orus",
  "temperature": 0.7,
  "thinking_budget": 1024,
  "avatar": "/static/avatars/professor.png",
  "system_prompt_file": "professor.txt",
  "proactive_audio": true,
  "enable_affective_dialog": true
}
```

### 4.4 WebSocket Session Lifecycle

```
1. User opens app, selects character
2. Frontend requests ephemeral token from backend: POST /api/token/professor
3. Backend generates locked ephemeral token with character's system prompt + voice
4. Frontend opens WebSocket to Gemini using ephemeral token
5. Frontend sends setup message (model config already locked in token)
6. Frontend starts streaming: 
   - Microphone audio → realtimeInput (audio chunks every ~100ms)
   - Camera frames → realtimeInput (JPEG frames every ~1s)
7. Gemini processes and streams back:
   - Audio response chunks → frontend plays immediately
   - Optional text transcription → frontend displays
8. VAD handles turn-taking automatically
9. Session auto-reconnects via session_resumption if disconnected
10. Session expires after 30 minutes (request new token to continue)
```

---

## 5. Multi-Character Support

### 5.1 Instance Architecture

Each "AI Human" character is NOT a separate deployment — it's a different configuration passed to the same Gemini model:

```
Same App, Different Config:

Character A ("The Professor")          Character B ("The Comedian")
├── system_prompt: professor.txt       ├── system_prompt: comedian.txt
├── voice: "Orus"                      ├── voice: "Puck" 
├── temperature: 0.7                   ├── temperature: 0.9
└── thinking_budget: 2048              └── thinking_budget: 512
```

### 5.2 Switching Characters

Two approaches:

**A. Character selection at start** — User picks character before connecting. Simple, clean.

**B. Multiple simultaneous sessions** — Run two WebSocket connections in parallel (one per character). More complex, higher cost, but allows "two AI humans talking to each other" demos.

---

## 6. Key Technical Challenges & Solutions

### 6.1 Echo Cancellation
**Problem**: The AI's voice output is picked up by the microphone, causing feedback loops.
**Solutions**:
- Recommend headphones (simplest, most reliable)
- Implement client-side echo cancellation using Web Audio API
- Use the `echoCancellation` constraint in getUserMedia
- Gemini's VAD helps — it detects when the model's own audio is playing

### 6.2 Mobile Battery & Performance
**Problem**: Continuous camera + mic + WebSocket drains battery.
**Solutions**:
- Capture video at 1 FPS (not 30 FPS)
- Use JPEG quality ~0.5 for frames (reduces bandwidth)
- Allow "audio-only" mode when visual context isn't needed
- Implement idle detection — reduce frame rate when nothing changes

### 6.3 Session Duration Limits
**Problem**: Gemini Live sessions have a 30-minute limit; WebSocket reconnects every 10 min.
**Solutions**:
- Use `session_resumption` in config — Gemini maintains conversation state across reconnects
- Frontend auto-reconnects transparently with new ephemeral token
- Display subtle "reconnecting..." indicator during handoff

### 6.4 Network Reliability on Mobile
**Problem**: WebSocket over TCP is fragile on mobile networks (packet loss = latency spikes).
**Solutions**:
- Implement exponential backoff reconnection
- Buffer audio output to smooth playback during brief disconnects
- Consider using a WebRTC wrapper like Daily/Pipecat for UDP transport (more complex but better for poor networks)

### 6.5 Cost Management
**Problem**: Video input is expensive (258 tokens/second).
**Solutions**:
- Adaptive frame rate: only send frames when the scene changes (use frame differencing)
- "Listen mode" vs "Look mode" — don't stream video when just chatting
- Set per-user session time limits
- Use the free tier for development (limited RPM)

---

## 7. Estimated Costs

### 7.1 Per-Session Cost (Gemini 2.5 Flash Native Audio)

| Component | Rate | 10-min session estimate |
|-----------|------|------------------------|
| Audio input (16kHz) | ~25 tokens/sec | ~15,000 tokens |
| Audio output (24kHz) | ~25 tokens/sec | ~7,500 tokens (model talks ~50% of time) |
| Video input (1 FPS) | ~258 tokens/sec | ~154,800 tokens |
| Text (system prompt) | ~varies | ~500 tokens |
| **Total per 10-min session** | | **~178,000 tokens** |

At Gemini 2.5 Flash pricing ($0.30/M input, $2.50/M output):
- Input cost: ~170K tokens × $0.30/M ≈ **$0.05**
- Output cost: ~8K tokens × $2.50/M ≈ **$0.02**
- **Total: ~$0.07 per 10-minute session**

*Note: Live API may have additional session-based charges. Verify with latest pricing.*

### 7.2 Free Tier Limits

The free tier allows limited Live API usage (lower RPM, sessions may be capped). Suitable for development and demos but not production.

---

## 8. Development Roadmap

### Phase 1: Proof of Concept (1-2 days)
- [ ] Fork Google's `live-api-web-console` React starter
- [ ] Get audio-only conversation working with one character
- [ ] Add system prompt customization
- [ ] Test on mobile browser (Chrome Android, Safari iOS)

### Phase 2: Video Integration (2-3 days)
- [ ] Add camera capture module (rear camera, 1 FPS JPEG)
- [ ] Stream video frames to Gemini alongside audio
- [ ] Verify object recognition / scene description works
- [ ] Add "What do you see?" test interactions

### Phase 3: Multi-Character & Polish (2-3 days)
- [ ] Build backend token service (FastAPI)
- [ ] Create character config system (prompt files + voice + params)
- [ ] Build character selection UI
- [ ] Add ephemeral token flow (replace hardcoded API key)
- [ ] Session resumption & reconnection handling

### Phase 4: Production Hardening (3-5 days)
- [ ] PWA manifest + service worker for installability
- [ ] Wake Lock API to prevent screen sleep
- [ ] Adaptive video frame rate (scene change detection)
- [ ] Error handling, offline states, network retry
- [ ] Usage monitoring & cost tracking
- [ ] Deploy backend to Cloud Run, frontend to Firebase Hosting / Vercel

---

## 9. Reference Implementations

| Resource | URL |
|----------|-----|
| **Google's Live API Web Console** (React starter, best starting point) | github.com/google-gemini/live-api-web-console |
| **Live API Getting Started Guide** | ai.google.dev/gemini-api/docs/live |
| **Live API Capabilities Guide** (video, audio, VAD, proactive audio) | ai.google.dev/gemini-api/docs/live-guide |
| **Ephemeral Tokens Guide** | ai.google.dev/gemini-api/docs/ephemeral-tokens |
| **Vertex AI Live API Quickstart Templates** | cloud.google.com/blog/.../how-to-use-gemini-live-api-native-audio-in-vertex-ai |
| **LiveKit Gemini Plugin** (alternative framework) | docs.livekit.io/agents/models/realtime/plugins/gemini/ |
| **Pipecat Framework** (open-source, cross-platform) | github.com/pipecat-ai/pipecat |

---

## 10. Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Model | Gemini 2.5 Flash Native Audio | Single model for audio+video+voice. No ElevenLabs needed. |
| Architecture | Client-to-Server (Option A) | Lowest latency. Ephemeral tokens for security. |
| Frontend | React PWA (TypeScript) | Google's starter is React. PWA for mobile installability. |
| Backend | Python FastAPI | Minimal — just token generation + character config. |
| Deployment | Cloud Run (backend) + Static hosting (frontend) | Serverless, scales to zero when idle. |
| Video approach | 1 FPS JPEG frames via same WebSocket | Built into Live API. No separate vision service. |
| Voice generation | Native audio output (Gemini) | No ElevenLabs. Lower latency, one fewer service. |
| Character system | Prompt files + voice config, locked into ephemeral tokens | Simple, secure, easy to add new characters. |
