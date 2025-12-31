import os
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv()

# 1. Credentials
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_NUMBER = os.getenv("TWILIO_NUMBER") 

# 2. Setup
# IMPORTANT: Use your active Ngrok URL here (e.g., https://your-id.ngrok-free.app)
NGROK_URL = os.getenv("NGROK_URL")
DESTINATION_NUMBER = os.getenv("DESTINATION_NUMBER")  # The number you want to call

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

def make_outbound_call():
    print(f"Initiating call to {DESTINATION_NUMBER}...")
    call = client.calls.create(
        from_=TWILIO_NUMBER,
        to=DESTINATION_NUMBER,
        url=f"{NGROK_URL}/incoming-call"
    )
    print(f"Call SID: {call.sid}. Waiting for answer...")

if __name__ == "__main__":
    make_outbound_call()