import "dotenv/config";
import express from "express";
import cors from "cors";
import { eq } from "drizzle-orm";
import { errorHandler } from "./middleware/error-handler";
import { db } from "./db";
import { users } from "./db/schema";
import branchesRouter from "./routes/branches";
import nodesRouter from "./routes/nodes";
import nodeContentsRouter from "./routes/node-contents";
import assessmentsRouter from "./routes/assessments";
import progressRouter from "./routes/progress";
import chatRouter from "./routes/chat";
import agentsRouter from "./routes/agents";
import documentsRouter from "./routes/documents";

const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";

async function ensureDefaultUser() {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, DEFAULT_USER_ID));
  if (!existing.length) {
    await db.insert(users).values({
      id: DEFAULT_USER_ID,
      email: "default@sprout.local",
      title: "Default Learner",
    });
    console.log("Default user seeded.");
  }
}

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/branches", branchesRouter);
app.use("/api/nodes", nodesRouter);
app.use("/api/nodes", nodeContentsRouter); // /api/nodes/:nodeId/contents & /generations
app.use("/api/nodes", documentsRouter); // /api/nodes/:nodeId/documents
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

ensureDefaultUser().then(() => {
  app.listen(PORT, () => {
    console.log(`Sprout backend running on http://localhost:${PORT}`);
  });
});

export default app;
