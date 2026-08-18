# Voice Agent Backend

A two-part voice-agent backend composed of:
- A Node.js/Express API that manages users, calls and agents, persists data in MongoDB, and coordinates with telephony and generative APIs.
- A Python microservice that handles audio, transcription (Deepgram) and Twilio-related voice processing.

The system is intended for projects that need programmable voice interactions (call triggering, transcription, and AI-powered responses).

## Features
- User management (authentication/authorization)
- Call triggering and Twilio integration
- Agent management and generative-AI integration (OpenAI / Google Generative AI)
- Speech transcription / audio processing via a Python microservice (Deepgram)
- MongoDB persistence via Mongoose

## Tech stack
- Languages: JavaScript (Node.js/Express) and Python
- Node runtime: Node.js (ES modules)
- Main Node dependencies: express, mongoose, dotenv, cors, cookie-parser, jsonwebtoken, bcrypt, twilio, openai / @google/generative-ai
- Python side: Deepgram + Twilio libs (see python-backend requirements)

## Repository layout
```
backend/             Node.js/Express API
  package.json
  src/
    index.js          server bootstrap (connects DB, starts app)
    app.js            Express app, middleware & route mounting
    routes/           API route definitions (users, calls, agents)
    controllers/      handlers implementing business logic
    models/           Mongoose schemas/models
    middlewares/      auth, error handling, etc.
    db/               DB connection helper
    utils/            helper utilities
python-backend/      Python microservice for audio/transcription
package-lock.json
```

## Quickstart — run both services locally

Prerequisites:
- Node 18+ and npm
- Python 3.8+
- MongoDB (URI for MONGO_URI)
- Twilio account (SID, token, phone number)
- Deepgram API key (for python-backend)
- OpenAI/Gemini API key (or other generative AI key) as needed

1. Clone
```bash
git clone https://github.com/diya05arora/voice_agent_backend.git
```

2. Run the Node backend
```bash
cd voice_agent_backend/backend
npm install
# create backend/.env (example below)
npm run dev   # development (uses nodemon)
# or
npm start     # production
```

3. Run the Python backend
```bash
cd ../python-backend
python -m venv venv
source venv/bin/activate
# pip install -r requirements.txt   # if present
# run the Python service according to its README or entrypoint (e.g. python app.py or uvicorn ...)
```

## Environment variables

Example backend/.env
```
NODE_ENV=development
PORT=7000
CORS_ORIGIN=*
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.example.mongodb.net/dbname
REFRESH_TOKEN_SECRET=your_refresh_token_secret
REFRESH_TOKEN_EXPIRY=30d
ACCESS_TOKEN_SECRET=your_access_token_secret
ACCESS_TOKEN_EXPIRY=15m
PYTHON_BACKEND_URL=http://localhost:8000    # url for python-backend
GEMINI_API_KEY=your_generative_api_key
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_NUMBER=+1xxxxxxxxxx
```

Example python-backend/.env (from python-backend/README)
```
DEEPGRAM_API_KEY=your_deepgram_api_key
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_NUMBER=+1xxxxxxxxxx
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.example.mongodb.net/dbname
PORT=8000
```

Important: Keep secrets out of version control. Use a secrets store in production.

## Main API endpoints (observed)
- Users: /api/v1/users (routes in backend/src/routes/user.routes.js)
- Calls:
  - POST /api/v1/calls/trigger-call — trigger outbound call flow (see backend/src/routes/call.routes.js)
- Agents: /api/v1/agents (routes in backend/src/routes/agent.routes.js)

(Controllers implement business logic — see backend/src/controllers/*.js for details.)

## Example: trigger a call
A simple curl example (adjust payload to match controller expectations):
```bash
curl -X POST http://localhost:7000/api/v1/calls/trigger-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1XXXXXXXXXX",
    "from": "+1YOUR_TWILIO_NUMBER",
    "agentId": "agent123",
    "metadata": { "userId": "user123" }
  }'
```
The controller typically calls Twilio and may forward audio handling to the Python microservice.
