// ============================================================
// AI Human — Frontend Application
// ============================================================

// --- State ---
let ws = null;
let audioContext = null;
let playbackContext = null;
let audioStream = null;
let videoStream = null;
let scriptProcessor = null;
let videoInterval = null;
let audioQueue = [];
let isPlaying = false;
let currentSource = null;

// --- DOM refs ---
const selectScreen = document.getElementById("select-screen");
const conversationScreen = document.getElementById("conversation-screen");
const characterList = document.getElementById("character-list");
const cameraPreview = document.getElementById("camera-preview");
const statusText = document.getElementById("status-text");
const speakingDot = document.getElementById("ai-speaking-dot");
const transcript = document.getElementById("transcript");
const endBtn = document.getElementById("end-btn");

// ============================================================
// Utility functions
// ============================================================

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
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

// ============================================================
// Character Selection
// ============================================================

async function loadCharacters() {
    try {
        const res = await fetch("/api/characters");
        const characters = await res.json();
        characterList.innerHTML = "";
        for (const c of characters) {
            const card = document.createElement("div");
            card.className = "character-card";
            card.innerHTML = `<h2>${c.name}</h2><p>${c.description}</p>`;
            card.addEventListener("click", () => startConversation(c.id));
            characterList.appendChild(card);
        }
    } catch (e) {
        console.error("Failed to load characters:", e);
        characterList.innerHTML = "<p>Failed to load characters.</p>";
    }
}

// ============================================================
// Start / End Conversation
// ============================================================

async function startConversation(characterId) {
    selectScreen.style.display = "none";
    conversationScreen.style.display = "block";
    statusText.textContent = "Connecting...";
    speakingDot.classList.remove("speaking");
    transcript.innerHTML = "";
    transcript.classList.remove("has-content");

    // Determine ws/wss based on page protocol
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/${characterId}`);

    ws.onopen = () => {
        console.log("WebSocket connected, waiting for Gemini setup...");
        statusText.textContent = "Setting up...";
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.setupComplete !== undefined) {
            console.log("Gemini setup complete");
            statusText.textContent = "Requesting permissions...";
            startMediaCapture();
            return;
        }

        handleGeminiMessage(msg);
    };

    ws.onclose = (event) => {
        console.log(`WebSocket closed: code=${event.code} reason=${event.reason}`);
        statusText.textContent = "Disconnected";
        speakingDot.classList.remove("speaking");
    };

    ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        statusText.textContent = "Connection error";
    };
}

function endConversation() {
    // Close WebSocket
    if (ws) {
        ws.close();
        ws = null;
    }

    // Stop audio capture
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
    }

    // Stop video capture
    if (videoInterval) {
        clearInterval(videoInterval);
        videoInterval = null;
    }
    if (videoStream) {
        videoStream.getTracks().forEach((t) => t.stop());
        videoStream = null;
    }
    cameraPreview.srcObject = null;

    // Stop audio playback
    audioQueue = [];
    isPlaying = false;
    if (currentSource) {
        try { currentSource.stop(); } catch (e) { /* ignore */ }
        currentSource = null;
    }
    if (playbackContext) {
        playbackContext.close();
        playbackContext = null;
    }

    // Return to character select
    conversationScreen.style.display = "none";
    selectScreen.style.display = "flex";
}

// ============================================================
// Media Capture (sequential to avoid permission conflicts)
// ============================================================

async function startMediaCapture() {
    try {
        // Request both permissions in a single getUserMedia call
        const combinedStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 768 },
                height: { ideal: 768 },
            },
        });
        audioStream = new MediaStream(combinedStream.getAudioTracks());
        videoStream = new MediaStream(combinedStream.getVideoTracks());
        console.log("Got audio + video permissions");
    } catch (e) {
        console.error("Media access error:", e.name, e.message);
        statusText.textContent = `Permission denied: ${e.message}`;
        return;
    }

    setupAudioCapture();
    setupVideoCapture();
    statusText.textContent = "Listening...";
}

// ============================================================
// Microphone Audio Capture
// ============================================================

async function setupAudioCapture() {

    audioContext = new AudioContext({ sampleRate: 16000 });
    // Resume for iOS
    if (audioContext.state === "suspended") {
        await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(audioStream);
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    // Use actual sample rate (browser may not support 16kHz)
    const actualRate = audioContext.sampleRate;
    console.log(`Audio capture sample rate: ${actualRate}`);

    scriptProcessor.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const float32Data = event.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
            int16Data[i] = Math.max(
                -32768,
                Math.min(32767, Math.floor(float32Data[i] * 32768))
            );
        }

        const base64Audio = arrayBufferToBase64(int16Data.buffer);
        ws.send(
            JSON.stringify({
                realtimeInput: {
                    mediaChunks: [
                        {
                            mimeType: `audio/pcm;rate=${actualRate}`,
                            data: base64Audio,
                        },
                    ],
                },
            })
        );
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
}

// ============================================================
// Camera Video Capture
// ============================================================

function setupVideoCapture() {
    cameraPreview.srcObject = videoStream;

    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 768;
    const ctx = canvas.getContext("2d");

    videoInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        ctx.drawImage(cameraPreview, 0, 0, 768, 768);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
        const base64Image = dataUrl.split(",")[1];

        ws.send(
            JSON.stringify({
                realtimeInput: {
                    mediaChunks: [
                        {
                            mimeType: "image/jpeg",
                            data: base64Image,
                        },
                    ],
                },
            })
        );
    }, 1000);
}

// ============================================================
// Audio Playback (Gemini voice responses)
// ============================================================

function ensurePlaybackContext() {
    if (!playbackContext || playbackContext.state === "closed") {
        playbackContext = new AudioContext({ sampleRate: 24000 });
    }
    if (playbackContext.state === "suspended") {
        playbackContext.resume();
    }
    return playbackContext;
}

function handleGeminiMessage(msg) {
    // Audio data in model response
    if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
                const pcmData = base64ToArrayBuffer(part.inlineData.data);
                audioQueue.push(pcmData);
                speakingDot.classList.add("speaking");
                if (!isPlaying) playNextChunk();
            }
        }
    }

    // Turn complete
    if (msg.serverContent?.turnComplete) {
        // Speaking dot will be removed when queue drains
    }

    // Interruption — stop playback
    if (msg.serverContent?.interrupted) {
        audioQueue = [];
        isPlaying = false;
        if (currentSource) {
            try { currentSource.stop(); } catch (e) { /* ignore */ }
            currentSource = null;
        }
        speakingDot.classList.remove("speaking");
    }

    // Output transcription (AI speech)
    if (msg.serverContent?.outputTranscription?.text) {
        appendTranscript("AI", msg.serverContent.outputTranscription.text);
    }

    // Input transcription (user speech)
    if (msg.serverContent?.inputTranscription?.text) {
        appendTranscript("You", msg.serverContent.inputTranscription.text);
    }
}

function playNextChunk() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        speakingDot.classList.remove("speaking");
        currentSource = null;
        return;
    }

    isPlaying = true;
    const ctx = ensurePlaybackContext();
    const pcmData = audioQueue.shift();

    // Convert Int16 PCM to Float32
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = playNextChunk;
    source.start();
    currentSource = source;
}

// ============================================================
// Transcript
// ============================================================

function appendTranscript(speaker, text) {
    if (!text.trim()) return;
    transcript.classList.add("has-content");
    const line = document.createElement("div");
    line.className = "transcript-line";
    const cls = speaker === "You" ? "you" : "ai";
    line.innerHTML = `<span class="speaker ${cls}">${speaker}:</span>${escapeHtml(text)}`;
    transcript.appendChild(line);
    transcript.scrollTop = transcript.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// Init
// ============================================================

loadCharacters();
