import twilio from 'twilio';


export async function triggerCall(req, res) {
    const { phoneNumber, agentId } = req.body;
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_NUMBER?.trim();
  const pythonBackendUrl = process.env.PYTHON_BACKEND_URL?.replace(/\/$/, "");

  if (!accountSid || !authToken || !from || !pythonBackendUrl) {
    return res.status(500).json({
      error: "Twilio or Python backend configuration is missing"
    });
  }

  if (!phoneNumber || !agentId) {
    return res.status(400).json({
      error: "phoneNumber and agentId are required"
    });
  }

  const client = twilio(accountSid, authToken);
  const webhookUrl = `${pythonBackendUrl}/incoming-call?agent_id=${encodeURIComponent(agentId)}`;

  console.log("Creating Twilio call", {
    from,
    toLastFour: String(phoneNumber).slice(-4),
    webhookHost: new URL(webhookUrl).host
  });

  try {
    const call = await client.calls.create({
      from,
      to: phoneNumber,
      url: webhookUrl,
      method: 'POST'
    });
    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("Twilio call creation failed", {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo
    });

    res.status(error.status || 500).json({
      error: error.message,
      code: error.code,
      moreInfo: error.moreInfo
    });
  }
}