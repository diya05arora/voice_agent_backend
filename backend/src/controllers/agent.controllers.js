import Agent from '../models/agent.models.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"
import { ApiError } from '../utils/ApiError.js';
import fs from 'fs';


function deleteUnusedFiles(filePath) {
    try {
        if (filePath) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error("Failed to delete avatar file:", error);
    }
}

export async function createAgent(req, res) {
    try {
        const { agentName, agentType, language } = req.body;
        const knowledgeBaseFilePath = req.file?.path;

        if (
            [agentName, agentType, language].some((field) => field?.trim() === "" || field === undefined)
        ) {
            deleteUnusedFiles(knowledgeBaseFilePath);
            return res.status(400).json({ message: "All fields are required" });
        }

        if (!knowledgeBaseFilePath) {
            deleteUnusedFiles(knowledgeBaseFilePath);
            throw new ApiError(400, "Knowledge Base file is required");
        }

        const fileMimeType = req.file.mimetype;
        const fileBase64 = fs.readFileSync(knowledgeBaseFilePath).toString('base64');

        // Upload Knowledge Base to Cloudinary
        let knowledgeBase;
        try {
            knowledgeBase = await uploadOnCloudinary(knowledgeBaseFilePath);
        } catch (error) {
            throw new ApiError(500, "Failed to upload Knowledge Base to Cloudinary");
        } finally {
            deleteUnusedFiles(knowledgeBaseFilePath);
        }

        const cloudinaryUrl = knowledgeBase?.url;
        const cloudinaryPublicId = knowledgeBase?.public_id;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // 1. Configure Gemini for Structured JSON Output
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const prompt = `
    You are a Voice AI Architect. Your task is to create a "systemPrompt" that will act as the brain for a voice agent.

    STRICT INSTRUCTIONS:
    1. Read the attached Knowledge Base carefully.
    2. The "systemPrompt" MUST include every factual detail found in the document, especially:
       - Specific benefits/amounts (e.g., money mentioned).
       - Eligibility rules (who can apply).
       - The exact list of requirements for registration.
    3. Format the "systemPrompt" to tell the AI: "You are an assistant for [Scheme Name]. Use these facts: [Insert Facts Here]. If asked for registration, list these 4 items: [Insert Items]."
    4. Keep the "greeting" short and in ${language}.
    5. The systemPrompt must be in English. Add the instruction that the agent must speak in the agent's language ${language}.

    Return a JSON object with:
    {
      "systemPrompt": "A comprehensive instruction set containing ALL document facts",
      "greeting": "A warm opening in ${language}"
    }
`;

        // 2. Generate Content
        const result = await model.generateContent([
            {
                inlineData: {
                    data: fileBase64,
                    mimeType: fileMimeType
                }
            }, { text: prompt }

        ]);
        const responseText = result.response.text();
        const aiData = JSON.parse(responseText);

        // 3. Save to MongoDB (Using camelCase to match your earlier schema)
        const newAgent = new Agent({
            adminId: req.user.id,
            agentName,
            agentType,
            language,
            knowledgeBase: cloudinaryUrl,
            knowledgeBasePublicId: cloudinaryPublicId,
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