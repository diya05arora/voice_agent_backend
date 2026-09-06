import asyncio
import base64
import json
import sys
import ssl
import os
import certifi
import re
import socket
from dotenv import load_dotenv
from pymongo import MongoClient
from bson import ObjectId
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

app = FastAPI()


class TwilioWebSocketAdapter:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await self.websocket.receive_text()
        except WebSocketDisconnect:
            raise StopAsyncIteration

    async def send(self, message: str):
        await self.websocket.send_text(message)


# ================== WINDOWS EVENT LOOP FIX ==================
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print("🪟 Windows event loop policy set")


# ================== ENV ==================
load_dotenv()
print("🌱 Environment variables loaded")


from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate


def hindi_to_english(text: str) -> str:
    if re.search(r"[\u0900-\u097F]", text):
        converted = transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS)
        print(f"🔤 Transliteration: '{text}' → '{converted}'")
        return converted
    return text


# ================== DB ==================
def get_db():
  return MongoClient(
      os.getenv("MONGO_URI"),
      tlsAllowInvalidCertificates=True  # ✅ Add this line
  )["test"]



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
    result = "".join(digits)
    if result:
        print(f"🔢 Extracted digits from '{text}' → {result}")
    return result


# ================== YES / CONFIRMATION ==================
YES_WORDS = {
    "yes", "yeah", "yep", "correct", "right",
    "haan", "han", "ha", "ji", "haanji", "jihaan"
}


def is_yes(text: str):
    clean = re.sub(r"[^\w]", "", text.lower())
    if clean in YES_WORDS:
        print(f"✅ Confirmation detected: '{text}'")
    return clean in YES_WORDS


CONFIRMATION_WORDS = {
    "haan", "han", "ha", "ji", "haanji", "jihaan"
}


def remove_confirmations(text: str) -> str:
    words = text.split()
    cleaned = " ".join(w for w in words if w.lower() not in CONFIRMATION_WORDS)
    if cleaned != text:
        print(f"🧹 Removed confirmations: '{text}' → '{cleaned}'")
    return cleaned


# ================== SAVE ==================
def save_form_submission(agent_id, answers, fields):
    print("📥 Preparing to save form submission")
    safe_answers = {}


    field_type_map = {f["key"]: f.get("type", "text") for f in fields}


    for key, value in answers.items():
        field_type = field_type_map.get(key, "text")


        if field_type == "number":
            digits = extract_digits(value)
            safe_answers[key] = digits if digits else None
        else:
            safe_answers[key] = hindi_to_english(value.strip())


        print(f"🧾 Field saved → {key}: {safe_answers[key]}")


    print(f"📦 Final payload: {safe_answers}")


    get_db().form_submissions.insert_one({
        "agentId": ObjectId(agent_id),
        "answers": safe_answers
    })


    print("✅ FINAL form saved to MongoDB")


# ================== DEEPGRAM CONNECT ==================
def sts_connect():
    print("🔌 Connecting to Deepgram STS")
    api_key = os.getenv("DEEPGRAM_API_KEY")


    ssl_context = ssl.create_default_context(cafile=certifi.where())
    ssl_context.options |= ssl.OP_NO_TICKET


    return websockets.connect(
        "wss://agent.deepgram.com/v1/agent/converse",
        subprotocols=["token", api_key],
        ssl=ssl_context,
        ping_interval=10,     # ⬆ mobile safe
        ping_timeout=10,
        open_timeout=60,      # ⬆ slow TLS / ngrok safe
        close_timeout=15,
        family=socket.AF_INET
    )


# ================== TWILIO HANDLER ==================
async def twilio_handler(twilio_ws):
    print("📞 Twilio WebSocket connected")


    audio_queue = asyncio.Queue()
    streamsid_queue = asyncio.Queue()
    agent_id_queue = asyncio.Queue()


    agent_id_value = None
    agent_speaking = False
    agent_ready = asyncio.Event()


    MULAW_SILENCE = b"\xff" * 3200


    async with sts_connect() as sts_ws:
        print("🤖 Deepgram agent session started")
        cartesia_key = os.getenv("CARTESIA_API_KEY")


        async def stop_agent_speech(streamsid):
            nonlocal agent_speaking
            agent_speaking = False
            await twilio_ws.send(json.dumps({
                "event": "clear",
                "streamSid": streamsid
            }))


        async def twilio_receiver():
            print("🎧 Listening to Twilio audio stream")
            buf = bytearray()
            async for msg in twilio_ws:
                data = json.loads(msg)


                if data["event"] == "start":
                    print(f"🚀 Call started | StreamSid: {data['start']['streamSid']}")
                    streamsid_queue.put_nowait(data["start"]["streamSid"])
                    agent_id_queue.put_nowait(
                        data["start"]["customParameters"]["agentId"]
                    )


                elif data["event"] == "media":
                    buf.extend(base64.b64decode(data["media"]["payload"]))
                    while len(buf) >= 6400:  # ⬆ tolerate mobile burst
                        audio_queue.put_nowait(buf[:3200])
                        buf = buf[3200:]


        async def configure_agent():
            nonlocal agent_id_value
            agent_id_value = await agent_id_queue.get()
            print(f"🆔 Agent ID received: {agent_id_value}")


            agent = get_db().agents.find_one({"_id": ObjectId(agent_id_value)})
            print(f"⚙️ Configuring agent ({agent.get('language', 'en')})")


            await sts_ws.send(json.dumps({
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
                                "description": "Submit collected form",
                                "parameters": {"type": "object", "properties": {}}
                            }
                        ]
                    },
                    "speak": {
                        "provider": {
                            "type": "cartesia",
                            "model_id": "sonic-2",
                            "voice": {
                                "mode": "id",
                                "id": "9358571b-7f13-41a0-b222-112c748eb31c"
                            },
                            "language": agent.get("language", "en")
                        },
                        "endpoint": {
                            "url": "https://api.cartesia.ai/tts/bytes",
                            "headers": {"x-api-key": cartesia_key}
                        }
                    }
                }
            }))


            print("✅ Agent configured successfully")
            agent_ready.set()


        async def sts_sender():
            await agent_ready.wait()
            print("📤 Sending audio to Deepgram (very slow-network safe)")
            try:
                while True:
                    try:
                        chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.6)
                    except asyncio.TimeoutError:
                        chunk = MULAW_SILENCE
                    await sts_ws.send(chunk)
            except websockets.exceptions.ConnectionClosed as e:
                print(f"🔕 STS sender closed (code={e.code}, reason={e.reason})")


        async def sts_receiver():
            nonlocal agent_speaking
            streamsid = await streamsid_queue.get()
            print(f"📡 STS receiver active | StreamSid: {streamsid}")


            while agent_id_value is None:
                await asyncio.sleep(0.01)


            agent = get_db().agents.find_one({"_id": ObjectId(agent_id_value)})
            fields = agent["formFields"]


            index = 0
            pending_value = ""
            collected = {}


            async for msg in sts_ws:
                if isinstance(msg, str):
                    data = json.loads(msg)


                    if data.get("type") == "FunctionCallRequest":
                        print("📨 submit_form function triggered")


                        final_answers = dict(collected)
                        if index < len(fields) and pending_value:
                            final_answers[fields[index]["key"]] = pending_value


                        save_form_submission(agent_id_value, final_answers, fields)


                        await sts_ws.send(json.dumps({
                            "type": "FunctionCallResponse",
                            "id": data["functions"][0]["id"],
                            "result": {"status": "ok"}
                        }))


                        await sts_ws.close(code=1000, reason="Form completed")
                        return


                    if data.get("type") == "ConversationText" and data.get("role") == "user":
                        text = data["content"]
                        print(f"🗣️ User said: {text}")


                        if agent_speaking:
                            await stop_agent_speech(streamsid)


                        if index >= len(fields):
                            continue


                        if is_yes(text):
                            if not pending_value:
                                continue
                            collected[fields[index]["key"]] = pending_value
                            pending_value = ""
                            index += 1
                            continue


                        field = fields[index]


                        if field["type"] == "number":
                            digits = extract_digits(text)
                            if digits:
                                pending_value += digits
                        else:
                            cleaned = remove_confirmations(text.strip(" .,!?"))
                            if cleaned:
                                pending_value = cleaned if not pending_value else f"{pending_value} {cleaned}"


                else:
                    agent_speaking = True
                    await twilio_ws.send(json.dumps({
                        "event": "media",
                        "streamSid": streamsid,
                        "media": {
                            "payload": base64.b64encode(msg).decode()
                        }
                    }))


        await asyncio.gather(
            twilio_receiver(),
            configure_agent(),
            sts_sender(),
            sts_receiver()
        )


# ================== TWILIO HTTP/WEBSOCKET ROUTES ==================
@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request):
        agent_id = request.query_params.get("agent_id")
        if not agent_id:
                return HTMLResponse("Missing agent_id", status_code=400)

        host = request.headers.get("x-forwarded-host") or request.url.hostname
        return HTMLResponse(f"""
<Response>
    <Connect>
        <Stream url="wss://{host}/media-stream/{agent_id}">
            <Parameter name="agentId" value="{agent_id}" />
        </Stream>
    </Connect>
</Response>
""", media_type="application/xml")


@app.websocket("/media-stream/{agent_id}")
async def media_stream(websocket: WebSocket, agent_id: str):
        await websocket.accept()
        print(f"🔁 Twilio media stream connected for agent {agent_id}")
        await twilio_handler(TwilioWebSocketAdapter(websocket))


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "5000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
