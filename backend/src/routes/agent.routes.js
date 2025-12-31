import { Router } from "express";
import {createAgent, getAgents, deleteAgent} from "../controllers/agent.controllers.js"
import { verifyJWT } from "../middlewares/auth.middlewares.js";
const router = Router()

router.route("/create-agent").post(verifyJWT,
    createAgent
)

router.route("/get-agents").get(verifyJWT,
    getAgents
) 

router.route("/delete-agent/:agentId").delete(verifyJWT,
    deleteAgent
)

export default router;