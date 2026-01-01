import twilio from 'twilio';


export async function triggerCall(req, res) {
    const { phoneNumber, agentId } = req.body; // Sent from React
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

  try {
    const call = await client.calls.create({
      from: process.env.TWILIO_NUMBER,
      to: phoneNumber,
      // Pass the agentId to Python via the URL query string
      url: `${process.env.NGROK_URL}/incoming-call?agent_id=${agentId}`,
      method: 'POST'
    });
    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}