import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
CHARACTERS_DIR = Path(__file__).parent / "characters"
TRANSCRIPTS_DIR = Path(__file__).parent / "transcripts"
TRANSCRIPTS_DIR.mkdir(exist_ok=True)

app = FastAPI()


def load_character(character_id: str) -> dict:
    config_path = CHARACTERS_DIR / f"{character_id}.json"
    prompt_path = CHARACTERS_DIR / f"{character_id}.txt"
    if not config_path.exists() or not prompt_path.exists():
        raise FileNotFoundError(f"Character '{character_id}' not found")
    config = json.loads(config_path.read_text())
    config["system_prompt"] = prompt_path.read_text()
    return config


@app.get("/api/characters")
async def get_characters():
    characters = []
    for json_file in sorted(CHARACTERS_DIR.glob("*.json")):
        config = json.loads(json_file.read_text())
        characters.append(config)
    return JSONResponse(characters)


@app.websocket("/ws/{character_id}")
async def websocket_proxy(ws: WebSocket, character_id: str):
    await ws.accept()

    try:
        character = load_character(character_id)
    except FileNotFoundError:
        await ws.close(code=4004, reason=f"Character '{character_id}' not found")
        return

    setup_message = {
        "setup": {
            "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
            "generation_config": {
                "response_modalities": ["AUDIO"],
                "speech_config": {
                    "voice_config": {
                        "prebuilt_voice_config": {
                            "voice_name": character["voice"]
                        }
                    }
                },
                "temperature": character["temperature"],
            },
            "system_instruction": {
                "parts": [{"text": character["system_prompt"]}]
            },
        }
    }

    gemini_ws_url = f"{GEMINI_WS_URL}?key={GOOGLE_API_KEY}"

    # Transcript state for this session
    session_start = datetime.now()
    transcript_file = TRANSCRIPTS_DIR / f"{character_id}_{session_start.strftime('%Y%m%d_%H%M%S')}.txt"
    transcript_lines: list[str] = []
    last_saved_index = 0

    def save_transcript():
        nonlocal last_saved_index
        if last_saved_index >= len(transcript_lines):
            return
        with open(transcript_file, "a") as f:
            if last_saved_index == 0:
                f.write(f"=== {character['name']} — {session_start.strftime('%Y-%m-%d %H:%M:%S')} ===\n\n")
            for line in transcript_lines[last_saved_index:]:
                f.write(line + "\n")
        last_saved_index = len(transcript_lines)

    try:
        async with websockets.connect(gemini_ws_url) as gemini_ws:
            # Send setup message
            await gemini_ws.send(json.dumps(setup_message))
            print(f"[{character_id}] Sent setup message to Gemini")

            # Wait for setupComplete
            setup_response = await gemini_ws.recv()
            setup_data = json.loads(setup_response)
            if "setupComplete" not in setup_data:
                print(f"[{character_id}] Unexpected setup response: {setup_data}")
                await ws.close(code=4001, reason="Gemini setup failed")
                return
            print(f"[{character_id}] Gemini setup complete")

            # Notify client that setup is complete
            await ws.send_json(setup_data)

            async def browser_to_gemini():
                try:
                    while True:
                        data = await ws.receive_text()
                        await gemini_ws.send(data)
                except WebSocketDisconnect:
                    print(f"[{character_id}] Browser disconnected")
                except Exception as e:
                    print(f"[{character_id}] browser→gemini error: {e}")

            async def gemini_to_browser():
                try:
                    async for message in gemini_ws:
                        text = message if isinstance(message, str) else message.decode()
                        # Extract transcriptions before forwarding
                        try:
                            msg = json.loads(text)
                            sc = msg.get("serverContent", {})
                            out = sc.get("outputTranscription", {}).get("text", "")
                            inp = sc.get("inputTranscription", {}).get("text", "")
                            if out.strip():
                                ts = datetime.now().strftime("%H:%M:%S")
                                line = f"[{ts}] AI: {out.strip()}"
                                print(f"[{character_id}] {line}")
                                transcript_lines.append(line)
                            if inp.strip():
                                ts = datetime.now().strftime("%H:%M:%S")
                                line = f"[{ts}] User: {inp.strip()}"
                                print(f"[{character_id}] {line}")
                                transcript_lines.append(line)
                        except (json.JSONDecodeError, AttributeError):
                            pass
                        await ws.send_text(text)
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"[{character_id}] Gemini disconnected: code={e.code} reason={e.reason}")
                except Exception as e:
                    print(f"[{character_id}] gemini→browser error: {e}")

            async def periodic_save():
                try:
                    while True:
                        await asyncio.sleep(30)
                        if transcript_lines[last_saved_index:]:
                            save_transcript()
                            print(f"[{character_id}] Transcript saved ({len(transcript_lines)} lines)")
                except asyncio.CancelledError:
                    pass

            # Run forwarding tasks + periodic save concurrently
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(browser_to_gemini()),
                    asyncio.create_task(gemini_to_browser()),
                    asyncio.create_task(periodic_save()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel remaining tasks
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            # Final save on session end
            save_transcript()
            if transcript_lines:
                print(f"[{character_id}] Final transcript saved to {transcript_file.name} ({len(transcript_lines)} lines)")

    except websockets.exceptions.InvalidStatusCode as e:
        print(f"[{character_id}] Gemini connection refused: {e}")
        await ws.close(code=4002, reason="Gemini connection failed")
    except Exception as e:
        print(f"[{character_id}] Proxy error: {e}")
        try:
            await ws.close(code=4003, reason="Internal proxy error")
        except Exception:
            pass

    print(f"[{character_id}] Session ended")


# Serve frontend static files (must be last — catches all other routes)
frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
