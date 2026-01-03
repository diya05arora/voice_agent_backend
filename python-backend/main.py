import asyncio
import sys
import base64
import json
import logging
import os
import re
import websockets

from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv
import uvicorn

# ================== WINDOWS FIX ==================
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ================== SETUP ==================
load_dotenv()
assert os.getenv("DEEPGRAM_API_KEY")
assert os.getenv("MONGODB_URI")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI()

# ================== DB ==================
def get_db():
    return MongoClient(os.getenv("MONGODB_URI"))["test"]

# ================== DEEPGRAM ==================
def sts_connect():
    return websockets.connect(
        "wss://agent.deepgram.com/v1/agent/converse",
        subprotocols=["token", os.getenv("DEEPGRAM_API_KEY")],
    )

# ================== DIGIT EXTRACTION ==================
NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3",
    "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9"
}

def extract_digits(text: str) -> str:
    parts = re.split(r"[ ,.-]+", text.lower())
    digits = []
    for p in parts:
        if p in NUMBER_WORDS:
            digits.append(NUMBER_WORDS[p])
        elif p.isdigit():
            digits.append(p)
    return "".join(digits)

def is_yes(text: str):
    clean = re.sub(r"[^\w]", "", text.lower())
    return clean in {"yes", "yeah", "yep", "correct", "right", "haan"}

# ================== SAVE (GENERIC & SCHEMA-DRIVEN) ==================
def save_form_submission(agent_id, answers, fields):
    safe_answers = {}

    field_type_map = {
        f["key"]: f.get("type", "text") for f in fields
    }

    for key, value in answers.items():
        field_type = field_type_map.get(key, "text")

        # 🔢 ANY numeric field (phone, aadhar, income, account, etc.)
        if field_type == "number":
            digits = extract_digits(value)
            safe_answers[key] = digits if digits else None

        # 📝 text fields
        else:
            safe_answers[key] = value.strip()

    logger.info(f"📦 Saving to DB: {safe_answers}")

    get_db().form_submissions.insert_one({
        "agentId": ObjectId(agent_id),
        "answers": safe_answers
    })

    logger.info("✅ FINAL form saved")

# ================== CONFIG ==================
def get_dynamic_config(agent):
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "mulaw", "sample_rate": 8000},
            "output": {"encoding": "mulaw", "sample_rate": 8000, "container": "none"}
        },
        "agent": {
            "language": agent.get("language", "en"),
            "greeting": agent.get("greeting"),
            "listen": {
                "provider": {"type": "deepgram", "model": "nova-3"}
            },
            "think": {
                "provider": {"type": "open_ai", "model": "gpt-4o-mini"},
                "prompt": agent.get("systemPrompt"),
                "functions": [
                    {
                        "name": "submit_form",
                        "description": "Submit the collected form",
                        "parameters": {"type": "object", "properties": {}}
                    }
                ]
            },
            "speak": {
                "provider": {"type": "deepgram", "model": "aura-2-thalia-en"}
            }
        }
    }

# ================== STREAM ==================
async def sts_sender(sts_ws, audio_queue):
    try:
        while True:
            await sts_ws.send(await audio_queue.get())
    except:
        pass

async def sts_receiver(sts_ws, websocket, streamsid_queue, agent_id):
    streamsid = await streamsid_queue.get()

    agent = get_db().agents.find_one({"_id": ObjectId(agent_id)})
    fields = agent["formFields"]

    index = 0
    pending_value = ""
    collected = {}

    async for msg in sts_ws:
        if isinstance(msg, str):
            data = json.loads(msg)

            # ===== FINAL SUBMIT =====
            if data.get("type") == "FunctionCallRequest":
                final_answers = dict(collected)

                if index < len(fields) and pending_value:
                    final_answers[fields[index]["key"]] = pending_value

                save_form_submission(agent_id, final_answers, fields)

                await sts_ws.send(json.dumps({
                    "type": "FunctionCallResponse",
                    "id": data["functions"][0]["id"],
                    "result": {"status": "ok"}
                }))
                break

            # ===== USER INPUT =====
            if data.get("type") == "ConversationText" and data.get("role") == "user":
                text = data["content"]

                if index >= len(fields):
                    continue

                # ===== CONFIRMATION =====
                if is_yes(text):
                    # ❌ Do NOT confirm if no value captured
                    if not pending_value:
                        logger.info("⚠️ Confirmation received but no value captured, asking again")
                        continue

                    collected[fields[index]["key"]] = pending_value
                    pending_value = ""
                    index += 1
                    continue


                # ===== FIELD VALUE =====
                field = fields[index]

                if field["type"] == "number":
                    digits = extract_digits(text)
                    if digits:
                        pending_value += digits
                else:
                    cleaned = text.strip(" .,!?")
                    pending_value = (
                        cleaned if not pending_value
                        else f"{pending_value} {cleaned}"
                    )

        else:
            await websocket.send_text(json.dumps({
                "event": "media",
                "streamSid": streamsid,
                "media": {
                    "payload": base64.b64encode(msg).decode()
                }
            }))

async def twilio_receiver(websocket, audio_queue, streamsid_queue):
    buf = bytearray()
    async for msg in websocket.iter_text():
        data = json.loads(msg)
        if data["event"] == "start":
            streamsid_queue.put_nowait(data["start"]["streamSid"])
        elif data["event"] == "media":
            buf.extend(base64.b64decode(data["media"]["payload"]))
            while len(buf) >= 3200:
                audio_queue.put_nowait(buf[:3200])
                buf = buf[3200:]

# ================== ROUTES ==================
@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request):
    agent_id = request.query_params.get("agent_id")
    host = request.url.hostname
    return HTMLResponse(f"""
<Response>
  <Connect>
    <Stream url="wss://{host}/media-stream/{agent_id}" />
  </Connect>
</Response>
""", media_type="application/xml")

@app.websocket("/media-stream/{agent_id}")
async def media_stream(websocket: WebSocket, agent_id: str):
    await websocket.accept()

    audio_queue = asyncio.Queue()
    streamsid_queue = asyncio.Queue()

    async with sts_connect() as sts_ws:
        agent = get_db().agents.find_one({"_id": ObjectId(agent_id)})
        await sts_ws.send(json.dumps(get_dynamic_config(agent)))

        await asyncio.gather(
            sts_sender(sts_ws, audio_queue),
            sts_receiver(sts_ws, websocket, streamsid_queue, agent_id),
            twilio_receiver(websocket, audio_queue, streamsid_queue),
        )

# ================== RUN ==================
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5000)