import Agent from '../models/agent.models.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function createAgent(req, res) {
  try {
    const {
      agentName,
      agentType,
      knowledgeBase,
      language = "en",
      formFields = []
    } = req.body;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    let prompt = "";

    // ================= FORM AGENT =================
    if (agentType === "form") {
      prompt = `
You are a Voice AI Form Assistant speaking to a user over a phone call.

SCHEME CONTEXT:
"${knowledgeBase}"

YOUR ROLE:
- Politely tell the user you will help them fill out the application form for this scheme.
- You MAY mention the scheme name exactly as provided in the scheme context.
- Do NOT explain scheme details, benefits, eligibility, or rules unless the user explicitly asks.
- Keep the conversation simple, calm, and reassuring.

🚨 CRITICAL START BEHAVIOR (IMPORTANT):
- After your greeting and explanation, you MUST IMMEDIATELY ask the FIRST form field question.
- Do NOT wait silently for the user to speak.
- Your FIRST spoken message MUST END WITH A QUESTION.

FORM FIELDS (order matters):
${JSON.stringify(formFields, null, 2)}

IMPORTANT:
- The backend handles all technical validation (digits, length, formatting).
- If the backend rejects an answer, politely ask the SAME question again.

STRICT CONVERSATION RULES:
- Ask ONLY ONE question at a time.
- Wait for the user to answer.
- Repeat the user's answer and ask for confirmation.
- Do NOT assume "yes", "okay", or similar words are valid field values.
- Do NOT move to the next field unless the current one is confirmed.

FIELD HANDLING RULES:
- For the field with key "phone":
  - Accept mobile numbers spoken digit-by-digit (e.g., "nine eight one...").
  - Do NOT reject answers just because they are spoken in words.
- For all other fields:
  - Accept any response longer than one character.

🚨 CRITICAL END BEHAVIOR (VERY IMPORTANT):
- After ALL fields are collected and confirmed:
  - Inform the user that the form has been successfully completed.
  - Thank the user politely.
  - DO NOT ask any further questions.
  - DO NOT wait for any user response.
  - IMMEDIATELY call submit_form.

- submit_form MUST be the FINAL and LAST action.
- Do NOT say anything after calling submit_form.

LANGUAGE RULES:
- Speak ONLY in ${language}.
- Do NOT switch languages.

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "systemPrompt": "...",
  "greeting": "..."
}
`;
    }

    // ================= QUERY / SURVEY AGENT =================
    else {
      prompt = `
You are a helpful voice AI assistant.

KNOWLEDGE BASE:
"${knowledgeBase}"

RULES:
- Answer clearly and concisely.
- Stay strictly within the knowledge base.
- Speak ONLY in ${language}.

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "systemPrompt": "...",
  "greeting": "..."
}
`;
    }

    // ===== Generate prompt =====
    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    // ===== Create agent =====
    const agent = await Agent.create({
      adminId: req.user.id,
      agentName,
      agentType,
      language,
      knowledgeBase,
      formFields: agentType === "form" ? formFields : [],
      systemPrompt: aiData.systemPrompt,
      greeting: aiData.greeting
    });

    res.status(201).json(agent);

  } catch (err) {
    console.error("❌ Agent creation failed:", err);
    res.status(500).json({ message: "Agent creation failed" });
  }
}

export async function getAgents(req, res) {
  const agents = await Agent.find({ adminId: req.user.id });
  res.json(agents);
}

export async function deleteAgent(req, res) {
  await Agent.findByIdAndDelete(req.params.agentId);
  res.json({ message: "Agent deleted" });
}
