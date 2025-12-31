import { Router } from "express";
import {triggerCall} from "../controllers/call.controllers.js"

const router = Router()

router.route("/trigger-call").post(
    triggerCall
)

export default router;