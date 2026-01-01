import Agent from '../models/agent.models.js';
import { GoogleGenerativeAI } from "@google/generative-ai";


export async function createAgent(req, res) {
    try {
        const { agentName, knowledgeBase, language } = req.body;
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // 1. Configure Gemini for Structured JSON Output
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const prompt = `
            You are an expert Voice AI Architect. 
            Based on the following Knowledge Base, generate a system prompt and a greeting.
            
            KNOWLEDGE BASE: "${knowledgeBase}"
            LANGUAGE: "${language}"

            Return a JSON object with exactly these two keys:
            1. "systemPrompt": A detailed persona and set of instructions for the AI.
            2. "greeting": A short, warm opening sentence in the specified language.
            
            Ensure the tone is helpful and professional.
        `;

        // 2. Generate Content
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const aiData = JSON.parse(responseText);

        // 3. Save to MongoDB (Using camelCase to match your earlier schema)
        const newAgent = new Agent({
            adminId: req.user.id,
            agentName,
            language,
            knowledgeBase,
            systemPrompt: aiData.systemPrompt,
            greeting: aiData.greeting
        });

        const savedAgent = await newAgent.save();
        res.status(201).json(savedAgent);

    } catch (error) {
        console.error("Gemini Agent Creation Error:", error);
        res.status(500).json({ message: "Failed to create agent", error: error.message });
    }
}

// Standard CRUD operations remain the same
export async function getAgents(req, res) {
    try {
        const agents = await Agent.find({ adminId: req.user.id });
        res.json(agents);
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
}

export async function deleteAgent(req, res) {
    try {
        const agent_id = req.params.agentId;
        await Agent.findByIdAndDelete(agent_id);
        res.json({ message: "Agent deleted" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
}