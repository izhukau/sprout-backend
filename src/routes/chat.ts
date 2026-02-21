import { Router } from "express";
import { db } from "../db";
import { chatSessions, chatMessages, hintEvents, nodes } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { tutorRespond, type ChatMessage } from "../agents/tutor-chat";

const router = Router();

// --- Sessions ---

// GET /api/chat/sessions?userId=&nodeId=
router.get("/sessions", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.query as Record<string, string>;
    let query = db.select().from(chatSessions).$dynamic();
    if (userId) query = query.where(eq(chatSessions.userId, userId));
    if (nodeId) query = query.where(eq(chatSessions.nodeId, nodeId));
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/sessions
router.post("/sessions", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.body;
    if (!userId)
      return res.status(400).json({ error: "userId is required" });
    const id = uuid();
    await db.insert(chatSessions).values({
      id,
      userId,
      nodeId: nodeId || null,
    });
    const created = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/chat/sessions/:id (end session)
router.patch("/sessions/:id", async (req, res, next) => {
  try {
    const { endedAt } = req.body;
    await db
      .update(chatSessions)
      .set({ endedAt: endedAt || new Date().toISOString() })
      .where(eq(chatSessions.id, req.params.id));
    const updated = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Session not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// --- Messages ---

// GET /api/chat/sessions/:sessionId/messages
router.get("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, req.params.sessionId));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/sessions/:sessionId/messages
router.post("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const { userId, role, kind, content, wasSuccessful, successSignal } =
      req.body;
    if (!userId || !role || !content)
      return res
        .status(400)
        .json({ error: "userId, role, and content are required" });
    const id = uuid();
    await db.insert(chatMessages).values({
      id,
      sessionId: req.params.sessionId,
      userId,
      role,
      kind: kind || "learning",
      content,
      wasSuccessful: wasSuccessful ?? null,
      successSignal: successSignal ? JSON.stringify(successSignal) : null,
    });
    const created = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// --- Hint Events ---

// POST /api/chat/hints
router.post("/hints", async (req, res, next) => {
  try {
    const {
      userId,
      nodeId,
      sessionId,
      requestMessageId,
      responseMessageId,
      referencedSuccessMessageIds,
    } = req.body;
    if (!userId || !nodeId)
      return res
        .status(400)
        .json({ error: "userId and nodeId are required" });
    const id = uuid();
    await db.insert(hintEvents).values({
      id,
      userId,
      nodeId,
      sessionId: sessionId || null,
      requestMessageId: requestMessageId || null,
      responseMessageId: responseMessageId || null,
      referencedSuccessMessageIds: referencedSuccessMessageIds
        ? JSON.stringify(referencedSuccessMessageIds)
        : null,
    });
    const created = await db
      .select()
      .from(hintEvents)
      .where(eq(hintEvents.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// GET /api/chat/hints?userId=&nodeId=
router.get("/hints", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.query as Record<string, string>;
    let query = db.select().from(hintEvents).$dynamic();
    if (userId) query = query.where(eq(hintEvents.userId, userId));
    if (nodeId) query = query.where(eq(hintEvents.nodeId, nodeId));
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// --- Tutor ---

// POST /api/chat/sessions/:sessionId/tutor
// Interactive tutoring: send student message, get AI tutor response.
// Send empty content to start the session.
router.post("/sessions/:sessionId/tutor", async (req, res, next) => {
  try {
    const { userId, content } = req.body;
    if (!userId)
      return res.status(400).json({ error: "userId is required" });

    // 1. Load the session
    const sessionResult = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, req.params.sessionId));
    if (!sessionResult.length)
      return res.status(404).json({ error: "Session not found" });

    const session = sessionResult[0];
    if (!session.nodeId)
      return res.status(400).json({ error: "Session has no linked node" });

    // 2. Load the subconcept node + parent concept
    const nodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, session.nodeId));
    if (!nodeResult.length)
      return res.status(404).json({ error: "Node not found" });

    const node = nodeResult[0];

    let parentConceptTitle: string | null = null;
    if (node.parentId) {
      const parentResult = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, node.parentId));
      if (parentResult.length) parentConceptTitle = parentResult[0].title;
    }

    // 3. Save student message to DB (if not empty)
    if (content && content.trim()) {
      await db.insert(chatMessages).values({
        id: uuid(),
        sessionId: req.params.sessionId,
        userId,
        role: "user",
        kind: "learning",
        content: content.trim(),
      });
    }

    // 4. Load full conversation history
    const history = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, req.params.sessionId))
      .orderBy(asc(chatMessages.createdAt));

    const messages: ChatMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // 5. Call the tutor agent
    const response = await tutorRespond(
      node.title,
      node.desc,
      parentConceptTitle,
      messages,
    );

    // 6. Save AI response to DB
    const aiMessageId = uuid();
    await db.insert(chatMessages).values({
      id: aiMessageId,
      sessionId: req.params.sessionId,
      userId,
      role: "assistant",
      kind: "learning",
      content: response.content,
    });

    // 7. If complete, end the session
    if (response.isComplete) {
      await db
        .update(chatSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(chatSessions.id, req.params.sessionId));
    }

    res.json({
      message: response.content,
      isComplete: response.isComplete,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
