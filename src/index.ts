import "dotenv/config";
import express from "express";
import { errorHandler } from "./middleware/error-handler";
import usersRouter from "./routes/users";
import branchesRouter from "./routes/branches";
import nodesRouter from "./routes/nodes";
import nodeContentsRouter from "./routes/node-contents";
import assessmentsRouter from "./routes/assessments";
import progressRouter from "./routes/progress";
import chatRouter from "./routes/chat";
import agentsRouter from "./routes/agents";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

// Routes
app.use("/api/users", usersRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/nodes", nodesRouter);
app.use("/api/nodes", nodeContentsRouter); // /api/nodes/:nodeId/contents & /generations
app.use("/api/assessments", assessmentsRouter);
app.use("/api/progress", progressRouter);
app.use("/api/chat", chatRouter);
app.use("/api/agents", agentsRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Sprout backend running on http://localhost:${PORT}`);
});

export default app;
