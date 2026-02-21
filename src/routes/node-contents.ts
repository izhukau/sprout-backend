import { Router } from "express";
import { db } from "../db";
import { nodeContents, nodeGenerations } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/nodes/:nodeId/contents
router.get("/:nodeId/contents", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(nodeContents)
      .where(eq(nodeContents.nodeId, req.params.nodeId));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/nodes/:nodeId/contents/active
router.get("/:nodeId/contents/active", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(nodeContents)
      .where(
        and(
          eq(nodeContents.nodeId, req.params.nodeId),
          eq(nodeContents.status, "active")
        )
      );
    res.json(result[0] || null);
  } catch (e) {
    next(e);
  }
});

// POST /api/nodes/:nodeId/contents
router.post("/:nodeId/contents", async (req, res, next) => {
  try {
    const {
      explanationMd,
      visualizationKind,
      visualizationPayload,
      generatedByModel,
      generationPromptHash,
      status,
    } = req.body;
    if (!explanationMd)
      return res.status(400).json({ error: "explanationMd is required" });
    const id = uuid();
    await db.insert(nodeContents).values({
      id,
      nodeId: req.params.nodeId,
      explanationMd,
      visualizationKind: visualizationKind || null,
      visualizationPayload: visualizationPayload || null,
      generatedByModel: generatedByModel || null,
      generationPromptHash: generationPromptHash || null,
      status: status || "active",
    });
    const created = await db
      .select()
      .from(nodeContents)
      .where(eq(nodeContents.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// GET /api/nodes/:nodeId/generations
router.get("/:nodeId/generations", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(nodeGenerations)
      .where(eq(nodeGenerations.nodeId, req.params.nodeId));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/nodes/:nodeId/generations
router.post("/:nodeId/generations", async (req, res, next) => {
  try {
    const { trigger, model, prompt, responseMeta } = req.body;
    if (!trigger)
      return res.status(400).json({ error: "trigger is required" });
    const id = uuid();
    await db.insert(nodeGenerations).values({
      id,
      nodeId: req.params.nodeId,
      trigger,
      model: model || null,
      prompt: prompt || null,
      responseMeta: responseMeta ? JSON.stringify(responseMeta) : null,
    });
    const created = await db
      .select()
      .from(nodeGenerations)
      .where(eq(nodeGenerations.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
