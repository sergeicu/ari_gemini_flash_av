# AI HUMAN — MVP Build Instructions for AI Coding Agent

## MISSION

Build a mobile-first web app called "AI Human" that uses Google's Gemini Live API to create an AI character that can SEE (phone camera), HEAR (microphone), and SPEAK (generated voice) in real-time. The user points their phone at the world and has a natural voice conversation with the AI about what it sees.

**This is an MVP. Prioritize working functionality over polish. Minimal UI. No tests. No CI/CD. Just make it work.**

---

## CONSTRAINTS & NON-NEGOTIABLES

1. **Single Google model only** — Use `gemini-2.5-flash-native-audio-preview-12-2025` via the Gemini Live API. No ElevenLabs. No separate STT/TTS services.
2. **Must work on mobile phone browsers** — Chrome Android and Safari iOS. Camera must use rear-facing camera by default.
3. **Must support two characters** — Each with their own system prompt file and voice. User picks character before starting.
4. **HTTPS required** — `getUserMedia` (camera/mic) requires secure context. Use ngrok for local dev.
5. **API key security** — Never expose the long-lived Google API key to the browser. Use ephemeral tokens OR a thin backend WebSocket proxy.

---

## TECHNOLOGY STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Vanilla HTML/JS or React (TypeScript) | Google's starter app is React, but vanilla JS is faster for MVP |
| Backend | Python FastAPI + `google-genai` SDK | Generates ephemeral tokens, serves character configs, serves static files |
| API | Gemini Live API via WebSocket | Single bidirectional connection for audio + video + responses |
| Hosting (dev) | localhost + ngrok | HTTPS tunnel for mobile testing |

---

## ARCHITECTURE DECISION: PICK ONE APPROACH

There are two valid approaches. Pick ONE based on what's simpler to get working:

### Approach A: Client-Direct with Ephemeral Tokens (RECOMMENDED — lower latency)

```
[Phone Browser] ---WebSocket---> [Gemini Live API]
      |
      |--- HTTPS POST /api/token ---> [Python Backend] (token generation only)
```

- Browser connects DIRECTLY to Gemini's WebSocket endpoint
- Backend's only job is generating short-lived ephemeral tokens with the character config locked in
- Lowest latency (no media proxying)
- Ephemeral tokens are a `v1alpha` feature — may have rough edges

### Approach B: Backend WebSocket Proxy (SIMPLER to implement, slightly higher latency)

```
[Phone Browser] ---WebSocket---> [Python Backend] ---WebSocket---> [Gemini Live API]
```

- Browser sends audio/video to YOUR backend via WebSocket
- Backend forwards everything to Gemini and relays responses back
- API key stays on server (simpler security model)
- Adds ~50-100ms latency per hop
- More moving parts but the data flow is easier to debug

**For MVP: Start with Approach B (proxy).** It's simpler to get working. You can migrate to Approach A later for production.

---

## FILE STRUCTURE

```
ai-human/
├── backend/
│   ├── main.py                    # FastAPI server: WebSocket proxy + static file serving
│   ├── requirements.txt           # google-genai, fastapi, uvicorn, websockets
│   ├── characters/
│   │   ├── professor.json         # {"name": "The Professor", "voice": "Orus", "system_prompt_file": "professor.txt", "temperature": 0.7}
│   │   ├── professor.txt          # Full system prompt text
│   │   ├── comedian.json          # {"name": "The Comedian", "voice": "Puck", "system_prompt_file": "comedian.txt", "temperature": 0.9}
│   │   └── comedian.txt           # Full system prompt text
│   └── .env                       # GOOGLE_API_KEY=your_key_here
├── frontend/
│   ├── index.html                 # Single-page app — character select + conversation UI
│   ├── app.js                     # Main app logic: WebSocket, audio capture/playback, video capture
│   └── style.css                  # Minimal mobile-first CSS
├── ngrok.yml                      # Optional ngrok config
└── README.md
```

---

## STEP-BY-STEP BUILD INSTRUCTIONS

### STEP 1: Backend — Python FastAPI Server

Create `backend/main.py`. This is the core of the MVP.

**What this file must do:**

1. Serve static files from `../frontend/` directory
2. Expose `GET /api/characters` — returns list of available characters
3. Expose `WebSocket /ws/{character_id}` — the main connection:
   - On connect: read character config, open WebSocket to Gemini Live API, send setup message
   - Forward all messages from browser → Gemini
   - Forward all messages from Gemini → browser
   - On disconnect: close Gemini session

**Gemini WebSocket connection details:**

```python
# WebSocket URL format:
GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"

# Connect with API key as query parameter:
ws_url = f"{GEMINI_WS_URL}?key={GOOGLE_API_KEY}"

# First message MUST be the setup message:
setup_message = {
    "setup": {
        "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
        "generation_config": {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": character_voice  # e.g., "Orus"
                    }
                }
            },
            "temperature": character_temperature
        },
        "system_instruction": {
            "parts": [{"text": system_prompt_text}]
        }
    }
}

# After sending setup, wait for setupComplete response from Gemini before forwarding client messages.
```

**Message forwarding logic:**

```python
# From browser client, you'll receive JSON messages. Forward them to Gemini as-is.
# Common client messages:
# - realtimeInput with audio data (base64 PCM chunks)
# - realtimeInput with video data (base64 JPEG frames)
# - clientContent with text messages

# From Gemini, you'll receive JSON messages. Forward them to browser as-is.
# Common server messages:
# - serverContent with modelTurn containing audio (base64 PCM) 
# - serverContent with modelTurn containing text
# - serverContent with outputTranscription
# - serverContent with interrupted: true
# - setupComplete
```

**Key implementation notes:**
- Use `websockets` library for the Gemini connection (async)
- Use FastAPI's built-in WebSocket support for the browser connection
- Run two concurrent async tasks: one forwarding browser→Gemini, one forwarding Gemini→browser
- Handle disconnection gracefully on both sides
- Log all errors — the Gemini WebSocket will close with error codes if the setup message is wrong

**requirements.txt:**
```
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
websockets>=12.0
python-dotenv>=1.0.0
```

Note: You do NOT need the `google-genai` SDK for Approach B — you're connecting via raw WebSocket. The SDK is only needed for Approach A (ephemeral tokens).

### STEP 2: Frontend — Single HTML Page

Create `frontend/index.html` — a single-page app with two screens:

**Screen 1: Character Selection**
- Show 2 cards, one per character (name + short description)
- Tapping a card transitions to Screen 2
- Minimal: just two big buttons stacked vertically

**Screen 2: Conversation**
- Full-screen camera preview (rear camera) as background
- Small "End" button in corner
- Visual indicator showing when AI is speaking (pulsing circle, anything simple)
- Optional: scrolling text transcript at bottom (from audio transcriptions)

**UI must be mobile-first:**
- No tiny buttons — everything touch-friendly
- Viewport meta tag for proper mobile scaling
- Full-screen camera — this IS the UI

### STEP 3: Frontend — JavaScript Core Logic (`app.js`)

This is the most complex file. It must handle:

#### 3a. WebSocket Connection to Backend

```javascript
// Connect to backend WebSocket with selected character
const ws = new WebSocket(`wss://${location.host}/ws/${characterId}`);

ws.onopen = () => {
    console.log('Connected to backend');
    startAudioCapture();
    startVideoCapture();
};

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleGeminiMessage(msg);
};
```

#### 3b. Microphone Audio Capture

```javascript
// CRITICAL: Gemini expects raw PCM 16-bit, 16kHz, mono, base64-encoded
// Use AudioContext + ScriptProcessorNode (or AudioWorklet) to capture raw PCM

async function startAudioCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            sampleRate: 16000,        // Request 16kHz
            channelCount: 1,           // Mono
            echoCancellation: true,    // Critical — prevents feedback loop
            noiseSuppression: true,
            autoGainControl: true
        }
    });
    
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    
    // Use ScriptProcessorNode to get raw PCM data
    // Buffer size of 4096 at 16kHz = 256ms chunks
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (event) => {
        const float32Data = event.inputBuffer.getChannelData(0);
        
        // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
        const int16Data = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
            int16Data[i] = Math.max(-32768, Math.min(32767, Math.floor(float32Data[i] * 32768)));
        }
        
        // Base64 encode
        const base64Audio = arrayBufferToBase64(int16Data.buffer);
        
        // Send to backend → Gemini
        ws.send(JSON.stringify({
            "realtimeInput": {
                "mediaChunks": [{
                    "mimeType": "audio/pcm;rate=16000",
                    "data": base64Audio
                }]
            }
        }));
    };
    
    source.connect(processor);
    processor.connect(audioContext.destination);  // Required for ScriptProcessor to work
}
```

**IMPORTANT AudioContext notes:**
- Mobile browsers may not support 16kHz natively. If `audioContext.sampleRate` differs from 16000, you MUST resample. Gemini accepts any sample rate if you specify it in the MIME type, so alternatively set `mimeType` to `audio/pcm;rate=${audioContext.sampleRate}`.
- iOS Safari requires a user gesture to create AudioContext. Start audio capture AFTER the user taps "Start Conversation".
- ScriptProcessorNode is deprecated but works everywhere. AudioWorklet is the modern replacement but adds complexity. For MVP, ScriptProcessorNode is fine.

#### 3c. Camera Video Capture

```javascript
// Capture rear camera, extract JPEG frames at ~1 FPS
// Gemini processes video at 1 FPS — sending more wastes tokens

async function startVideoCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: { ideal: "environment" },  // Rear camera
            width: { ideal: 768 },
            height: { ideal: 768 }
        }
    });
    
    // Show camera preview on screen
    const videoElement = document.getElementById('camera-preview');
    videoElement.srcObject = stream;
    
    // Canvas for frame extraction
    const canvas = document.createElement('canvas');
    canvas.width = 768;   // Gemini recommends 768x768 for best results
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    
    // Send frame every 1 second
    setInterval(() => {
        ctx.drawImage(videoElement, 0, 0, 768, 768);
        
        // Get JPEG as base64 (quality 0.5 to save bandwidth)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        const base64Image = dataUrl.split(',')[1];
        
        // Send to backend → Gemini
        ws.send(JSON.stringify({
            "realtimeInput": {
                "mediaChunks": [{
                    "mimeType": "image/jpeg",
                    "data": base64Image
                }]
            }
        }));
    }, 1000);  // 1 FPS
}
```

**IMPORTANT video notes:**
- On mobile, the video element MUST have `playsinline` attribute or iOS won't show it
- `facingMode: "environment"` = rear camera. `"user"` = front/selfie camera
- 768x768 is Google's recommended resolution. Larger wastes tokens, smaller reduces quality.
- JPEG quality 0.5 is a good balance for mobile bandwidth

#### 3d. Audio Playback (Playing Gemini's Voice Response)

```javascript
// Gemini sends audio as base64-encoded PCM, 24kHz, 16-bit, mono
// We need to decode and play it through an AudioContext

const playbackContext = new AudioContext({ sampleRate: 24000 });
let audioQueue = [];
let isPlaying = false;

function handleGeminiMessage(msg) {
    // Check for audio data in model response
    if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                const pcmData = base64ToArrayBuffer(part.inlineData.data);
                audioQueue.push(pcmData);
                if (!isPlaying) playNextChunk();
            }
        }
    }
    
    // Check for interruption — stop playback immediately
    if (msg.serverContent?.interrupted) {
        audioQueue = [];
        isPlaying = false;
        // Stop any currently playing audio
    }
    
    // Check for transcription (optional — display in UI)
    if (msg.serverContent?.outputTranscription?.text) {
        appendTranscript('AI', msg.serverContent.outputTranscription.text);
    }
    if (msg.serverContent?.inputTranscription?.text) {
        appendTranscript('You', msg.serverContent.inputTranscription.text);
    }
}

function playNextChunk() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }
    
    isPlaying = true;
    const pcmData = audioQueue.shift();
    
    // Convert Int16 PCM to Float32 for Web Audio API
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    
    // Create AudioBuffer and play
    const audioBuffer = playbackContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);
    
    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContext.destination);
    source.onended = playNextChunk;  // Play next chunk when this one finishes
    source.start();
}
```

**IMPORTANT playback notes:**
- iOS Safari requires `playbackContext.resume()` after a user gesture
- Echo cancellation via `getUserMedia` constraints should prevent the AI from hearing its own voice, but RECOMMEND HEADPHONES for best experience
- The audio queue approach handles Gemini sending audio in small chunks — they get queued and played sequentially

#### 3e. Utility Functions

```javascript
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}
```

### STEP 4: Character Prompt Files

Create two character files. Each character needs a `.json` config and a `.txt` system prompt.

**`characters/professor.json`:**
```json
{
    "id": "professor",
    "name": "The Professor",
    "description": "A warm, curious scientist who loves explaining what they see",
    "voice": "Orus",
    "temperature": 0.7
}
```

**`characters/professor.txt`:**
```
You are The Professor — a warm, endlessly curious scientist with a gift for making complex things simple. You're looking through a camera and can see the world in front of you.

BEHAVIOR:
- Actively comment on and describe interesting things you see through the camera
- When you see people, engage them warmly — ask about what they're doing, comment on their surroundings
- When you see objects, explain fascinating facts about them
- Speak naturally and conversationally — short sentences, not lectures
- Show genuine excitement and wonder about everyday things
- If someone asks you a question, answer while referencing what you can see
- If the scene is boring or hasn't changed, you can ask the user what they'd like to explore

PERSONALITY:
- Warm, approachable, grandfatherly/grandmotherly energy
- Uses analogies and stories to explain things
- Occasionally makes gentle, nerdy jokes
- Never condescending — treats everyone as a fellow explorer

CONSTRAINTS:
- Keep responses concise — 2-3 sentences max unless asked to elaborate
- You're having a real-time conversation, not giving a presentation
- Don't describe everything you see in exhaustive detail — pick the most interesting thing
```

**`characters/comedian.json`:**
```json
{
    "id": "comedian",
    "name": "The Comedian",
    "description": "A witty, observational comedian who finds humor in everything",
    "voice": "Puck",
    "temperature": 0.9
}
```

**`characters/comedian.txt`:**
```
You are The Comedian — a quick-witted, observational comedian with a sharp eye for the absurd. You're looking through a camera and can see the world in front of you.

BEHAVIOR:
- Make funny observations about what you see — find the humor in ordinary things
- Your comedy style is observational, like Jerry Seinfeld or John Mulaney — "What's the deal with...?"
- When you see people, make lighthearted (never mean) jokes about the situation
- When you see objects, find the funny angle — the absurdity of everyday life
- Engage in banter with whoever is talking to you
- If nothing interesting is visible, riff on the situation itself ("Are we just staring at a wall? This is my life now?")

PERSONALITY:
- Quick, punchy delivery — setup, punchline, move on
- Self-deprecating humor is fine
- Never mean-spirited, racist, sexist, or punching down
- Confident but not arrogant — more "class clown" than "edgy comedian"
- Occasionally breaks character to genuinely appreciate something beautiful or interesting

CONSTRAINTS:
- Keep it SHORT — comedy is about timing, not essays
- 1-2 sentences per response unless doing a bit
- React quickly to what you see — don't overthink it
- You're performing for one person, not a crowd — keep it intimate and conversational
```

### STEP 5: Mobile CSS

**`frontend/style.css`:**

The UI should be:
- Full-screen camera preview as the background
- Dark overlay at top for status indicators
- Character selection as two large, tappable cards
- A floating "End Conversation" button
- A semi-transparent transcript area at the bottom (optional, can be toggled)

Key CSS requirements:
```css
/* Viewport must fill screen on mobile */
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }

/* Camera preview fills entire screen */
#camera-preview { 
    position: fixed; top: 0; left: 0; 
    width: 100%; height: 100%; 
    object-fit: cover;  /* CRITICAL: cover, not contain */
}

/* All UI floats on top of camera */
.overlay { position: fixed; z-index: 10; }

/* Touch-friendly buttons — minimum 44px tap target (Apple HIG) */
button { min-height: 44px; min-width: 44px; font-size: 16px; }
```

### STEP 6: HTML Structure

**`frontend/index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AI Human</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- Screen 1: Character Selection -->
    <div id="select-screen">
        <h1>AI Human</h1>
        <p>Choose a character</p>
        <div id="character-list">
            <!-- Populated by JS from /api/characters -->
        </div>
    </div>
    
    <!-- Screen 2: Conversation (hidden initially) -->
    <div id="conversation-screen" style="display:none;">
        <video id="camera-preview" autoplay playsinline muted></video>
        
        <!-- Speaking indicator -->
        <div id="status-indicator" class="overlay">
            <div id="ai-speaking-dot"></div>
            <span id="status-text">Connecting...</span>
        </div>
        
        <!-- Transcript (optional) -->
        <div id="transcript" class="overlay"></div>
        
        <!-- End button -->
        <button id="end-btn" class="overlay" onclick="endConversation()">End</button>
    </div>
    
    <script src="app.js"></script>
</body>
</html>
```

**CRITICAL HTML notes:**
- `playsinline` on `<video>` is REQUIRED for iOS — without it, video goes fullscreen
- `muted` on `<video>` is required because we're showing the camera preview, not playing audio from it
- `user-scalable=no` prevents zoom on double-tap
- `maximum-scale=1.0` prevents pinch zoom (keeps UI stable)

### STEP 7: Running the MVP

```bash
# 1. Install backend dependencies
cd backend
pip install -r requirements.txt

# 2. Set your Google API key
echo "GOOGLE_API_KEY=your_key_here" > .env

# 3. Start the server
uvicorn main:app --host 0.0.0.0 --port 8000

# 4. In another terminal, start ngrok for HTTPS (required for camera/mic on mobile)
ngrok http 8000

# 5. Open the ngrok HTTPS URL on your phone
# e.g., https://abc123.ngrok.io
```

---

## GOTCHAS & DEBUGGING GUIDE

### Common Issues the Coding Agent WILL Encounter

1. **"getUserMedia not allowed"** → You're on HTTP, not HTTPS. Use ngrok.

2. **Gemini WebSocket closes immediately with code 1007** → Setup message format is wrong. The most common issue:
   - The model string must be `"models/gemini-2.5-flash-native-audio-preview-12-2025"` (with `models/` prefix) in the raw WebSocket API
   - OR it could be `"gemini-2.5-flash-native-audio-preview-12-2025"` (without prefix) depending on the API version
   - Try both. Log the exact error message from the WebSocket close event.

3. **No audio plays back** → Check that:
   - You're converting base64 → Int16 → Float32 correctly
   - AudioContext sample rate is 24000 for playback
   - AudioContext is resumed after user gesture (iOS)
   - You're looking for audio in `msg.serverContent.modelTurn.parts[].inlineData`

4. **Audio feedback loop (AI hears itself)** → Enable `echoCancellation: true` in getUserMedia AND recommend headphones.

5. **Camera shows black on iOS** → Missing `playsinline` attribute on `<video>` element.

6. **WebSocket message format** → When using raw WebSocket (not the SDK), messages are JSON. The exact field names use camelCase (JavaScript convention). Double check: `realtimeInput`, `mediaChunks`, `mimeType`, `serverContent`, `modelTurn`, `inlineData`.

7. **Video frames not being processed** → Gemini processes video at 1 FPS. If you're sending too fast, it may drop frames. Stick to 1 frame per second. Also verify the JPEG base64 is valid — test by decoding it back to an image.

8. **Session disconnects after 10 minutes** → This is the default session limit. To extend to 30 minutes, you need to configure session resumption. For MVP, just reconnect automatically when the WebSocket closes.

9. **API version matters** — Some features (affective dialog, proactive audio) require `v1alpha` API version. The WebSocket URL path includes the API version. Use `v1alpha` for maximum feature access:
   ```
   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent
   ```

10. **Rate limits on free tier** → If you get 429 errors, you're hitting rate limits. The free tier has restrictive limits for Live API. You may need to enable billing for sustained testing.

---

## OPTIONAL ENHANCEMENTS (ONLY AFTER MVP WORKS)

These are nice-to-haves. Do NOT implement until the core audio+video conversation works:

1. **Enable audio transcriptions** — Add `"output_audio_transcription": {}` and `"input_audio_transcription": {}` to the setup config. Then display transcripts in the UI.

2. **Enable affective dialog** — Add `"enable_affective_dialog": true` to setup config (requires `v1alpha`).

3. **Enable proactive audio** — Add `"proactivity": {"proactive_audio": true}` to setup config. This makes the AI only respond when it thinks it's being addressed.

4. **Add thinking** — Add `"thinking_config": {"thinking_budget": 1024}` to the generation config for more reasoned responses.

5. **Session resumption** — Add `"session_resumption": {}` to the setup config. This allows the session to survive WebSocket reconnections.

6. **PWA manifest** — Add a `manifest.json` so users can "install" the app on their phone home screen.

7. **Wake Lock** — Use the Wake Lock API to prevent the phone screen from sleeping during conversation.

---

## ACCEPTANCE CRITERIA FOR MVP

The MVP is DONE when:

- [ ] User opens the app on their phone and sees two character options
- [ ] User taps a character and the camera activates (rear camera)
- [ ] User speaks and the AI responds with voice (through phone speaker or headphones)
- [ ] AI can see and comment on what the camera is pointing at ("I see a coffee mug on a desk...")
- [ ] User can have a natural back-and-forth voice conversation
- [ ] User can interrupt the AI mid-sentence and it stops and responds to the new input
- [ ] Two different characters have noticeably different personalities and voices
- [ ] User can end the conversation and pick a different character
- [ ] App works on Chrome Android with headphones plugged in

---

## REFERENCE CODE & RESOURCES

Before writing any code, study these resources:

| Resource | What to learn from it |
|----------|----------------------|
| `github.com/google-gemini/live-api-web-console` | The official React starter app. Study how it handles WebSocket connection, audio capture/playback, and video frame extraction. This is the gold standard reference. |
| `github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo` | Vanilla JS implementation (simpler than the React version). Study the WebSocket message format and audio handling. |
| `ai.google.dev/gemini-api/docs/live` | Official docs — getting started, code samples |
| `ai.google.dev/gemini-api/docs/live-guide` | Capabilities guide — video input, audio config, VAD, native audio features |
| `ai.google.dev/api/live` | WebSocket API reference — exact message schemas |
| `ai.google.dev/gemini-api/docs/ephemeral-tokens` | For Approach A (client-direct) |

**The single most important reference is the `live-api-web-console` repo.** Clone it, run it, read the source. Much of the audio/video handling code can be adapted directly.

---

## QUICK REFERENCE: GEMINI LIVE API MESSAGE FORMAT

### Setup (first message from client after WebSocket opens):
```json
{
    "setup": {
        "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
        "generation_config": {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": "Orus"
                    }
                }
            }
        },
        "system_instruction": {
            "parts": [{"text": "You are a helpful assistant..."}]
        }
    }
}
```

### Send audio (ongoing, every ~250ms):
```json
{
    "realtimeInput": {
        "mediaChunks": [{
            "mimeType": "audio/pcm;rate=16000",
            "data": "<base64-encoded-PCM-audio>"
        }]
    }
}
```

### Send video frame (every ~1 second):
```json
{
    "realtimeInput": {
        "mediaChunks": [{
            "mimeType": "image/jpeg",
            "data": "<base64-encoded-JPEG>"
        }]
    }
}
```

### Receive audio response (from Gemini):
```json
{
    "serverContent": {
        "modelTurn": {
            "parts": [{
                "inlineData": {
                    "mimeType": "audio/pcm;rate=24000",
                    "data": "<base64-encoded-PCM-audio>"
                }
            }]
        }
    }
}
```

### Receive turn complete:
```json
{
    "serverContent": {
        "turnComplete": true
    }
}
```

### Receive interruption:
```json
{
    "serverContent": {
        "interrupted": true
    }
}
```

---

## FINAL NOTES FOR THE CODING AGENT

1. **Start simple.** Get audio-only working first (no video). Once you can talk to Gemini and hear it respond, add video.

2. **Test on desktop first, then mobile.** getUserMedia works on desktop Chrome too. Get it working there before dealing with mobile quirks.

3. **Log everything.** Log every WebSocket message in both directions during development. The Gemini API errors are informative if you can see them.

4. **The Google starter app is your friend.** Don't reinvent the wheel. Study `live-api-web-console` source code for audio worklet implementation, base64 encoding patterns, and message handling.

5. **Headphones are not optional for testing.** Without headphones, echo cancellation is unreliable and the AI will hear itself, causing a feedback loop.

6. **When in doubt about message format**, check the raw WebSocket API reference at `ai.google.dev/api/live`. The SDK abstracts away the message format, but since we're using raw WebSocket (Approach B), we need the exact JSON structure.
