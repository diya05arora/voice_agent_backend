import express from "express"
import cors from "cors"
import userRouter from "./routes/user.routes.js"
import callRouter from "./routes/call.routes.js"
import agentRouter from "./routes/agent.routes.js"

import cookieParser from "cookie-parser"
import { errorHandler } from "./middlewares/error.middlewares.js"

const app = express()
// middlewares
app.use(
    cors({
        origin: process.env.CORS_ORIGIN,
        credentials: true
    })
)

// common middlewares
app.use(express.json({limit: "16kb"}));
app.use(express.urlencoded({extended: true, limit: "16kb"}));
app.use(express.static("public"))
app.use(cookieParser());

// routes
app.use("/api/v1/users", userRouter);
app.use("/api/v1/calls", callRouter);
app.use("/api/v1/agents", agentRouter);
app.use(errorHandler);

export { app }