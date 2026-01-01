import asyncio
import base64
import json
import logging
import os
import websockets
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect
import uvicorn
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI()

# --- MongoDB Setup ---
# Ensure MONGO_URI is in your .env file


# --- Deepgram Connection ---
def sts_connect():
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        raise Exception("DEEPGRAM_API_KEY environment variable not set")
    
    return websockets.connect(
        "wss://agent.deepgram.com/v1/agent/converse",
        subprotocols=["token", api_key]
    )

# --- NEW: Dynamic Config Generator ---
def get_dynamic_config(agent_id):
    client = MongoClient(os.getenv("MONGODB_URI"))
    DB_NAME = "voice-agent"
    db = client[DB_NAME]
    agents_collection = db.agents

    clean_id = str(agent_id).strip()
    """Fetches agent details from MongoDB and builds the Deepgram config."""
    # Convert string ID to MongoDB ObjectId
    agent_data = agents_collection.find_one({
        "$or" : [
            {"_id": ObjectId(clean_id)},
            {"_id" : clean_id}  # In case IDs are stored as strings
        ]
    })
    
    if not agent_data:
        raise Exception("Agent not found.")

    # Map languages to appropriate voice models
    language = agent_data.get("language", "en")
    voice_model_map = {
        "en": "aura-2-thalia-en",
        "hi": "aura-2-luna-hi",  # Hindi female voice
    }
    voice_model = voice_model_map.get(language, "aura-2-thalia-en")
    

    # This structure matches the config.json you shared earlier
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "mulaw", "sample_rate": 8000},
            "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"}
        },
        "agent": {
            "language": language,
            "listen": {
                "provider": {"type": "deepgram", "model": "nova-3"}
            },
            "think": {
                "provider": {
                    "type": "open_ai",
                    "model": "gpt-4o-mini",
                    "temperature": 0.7
                },
                "prompt": agent_data.get("systemPrompt") # DYNAMIC
            },
            "speak": {
                "provider": {"type": "deepgram", "model": voice_model}
            },
            "greeting": agent_data.get("greeting") # DYNAMIC
        }
    }

# --- Logic Handlers ---
async def handle_barge_in(decoded, websocket, streamsid):
    if decoded.get("type") == "UserStartedSpeaking":
        clear_message = {"event": "clear", "streamSid": streamsid}
        await websocket.send_text(json.dumps(clear_message))

async def sts_sender(sts_ws, audio_queue):
    while True:
        chunk = await audio_queue.get()
        await sts_ws.send(chunk)

async def sts_receiver(sts_ws, websocket, streamsid_queue):
    streamsid = await streamsid_queue.get()
    try:
        async for message in sts_ws:
            if isinstance(message, str):
                decoded = json.loads(message)
                await handle_barge_in(decoded, websocket, streamsid)
            else:
                media_message = {
                    "event": "media",
                    "streamSid": streamsid,
                    "media": {"payload": base64.b64encode(message).decode("ascii")}
                }
                try:
                    await websocket.send_text(json.dumps(media_message))
                except WebSocketDisconnect:
                    logger.info("Client disconnected while sending media")
                    break
    except Exception as e:
        logger.error(f"Error in sts_receiver: {e}")

async def twilio_receiver(websocket, audio_queue, streamsid_queue):
    BUFFER_SIZE = 20 * 160
    inbuffer = bytearray(b"")
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            if data["event"] == "start":
                streamsid_queue.put_nowait(data["start"]["streamSid"])
            elif data["event"] == "media":
                chunk = base64.b64decode(data["media"]["payload"])
                inbuffer.extend(chunk)
                while len(inbuffer) >= BUFFER_SIZE:
                    audio_queue.put_nowait(inbuffer[:BUFFER_SIZE])
                    inbuffer = inbuffer[BUFFER_SIZE:]
            elif data["event"] == "stop":
                logger.info("Twilio stop event received")
                break
    except WebSocketDisconnect:
        logger.info("Twilio WebSocket disconnected")
    except Exception as e:
        logger.error(f"Error in twilio_receiver: {e}")

# --- Updated FastAPI Routes ---

@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request):
    # 1. Twilio passes the agent_id here from your Node.js trigger
    agent_id = request.query_params.get("agent_id")
    host = request.url.hostname
    
    
    if not agent_id:
        print("ERROR: agent_id is missing from the request!")
        return HTMLResponse(content="<Response><Say>Error: No agent configured</Say></Response>", media_type="application/xml")
    
    # 2. We pass that agent_id into the WebSocket URL using path parameter
    # Twilio's Stream component doesn't support query params, so use path params
    twiml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
            <Stream url="wss://{host}/media-stream/{agent_id}" />
        </Connect>
    </Response>"""
    
    return HTMLResponse(content=twiml_content, media_type="application/xml")

@app.websocket("/media-stream/{agent_id}")
async def handle_media_stream(websocket: WebSocket, agent_id: str):
    await websocket.accept()

    if not agent_id:
        logger.error("CRITICAL: No agent_id found in WebSocket connection!")
        await websocket.close()
        return
    
    audio_queue = asyncio.Queue()
    streamsid_queue = asyncio.Queue()

    try:
        async with sts_connect() as sts_ws:
            # 4. Fetch dynamic config from MongoDB and send to Deepgram
            config = get_dynamic_config(agent_id)
            await sts_ws.send(json.dumps(config))
            logger.info(f"Connected to Deepgram for agent {agent_id}")

            await asyncio.gather(
                sts_sender(sts_ws, audio_queue),
                sts_receiver(sts_ws, websocket, streamsid_queue),
                twilio_receiver(websocket, audio_queue, streamsid_queue),
                return_exceptions=True
            )
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for agent {agent_id}")
    except Exception as e:
        logger.error(f"Error in handle_media_stream: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info(f"Media stream closed for agent {agent_id}")

if __name__ == "__main__":
    port = int(os.environ.get("PORT"))
    uvicorn.run(app, host="0.0.0.0", port=port)