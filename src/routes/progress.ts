import { Router } from "express";
import { db } from "../db";
import { userNodeProgress } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/progress?userId=&nodeId=
router.get("/", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.query as Record<string, string>;
    if (!userId)
      return res.status(400).json({ error: "userId query param required" });

    const conditions = [eq(userNodeProgress.userId, userId)];
    if (nodeId) conditions.push(eq(userNodeProgress.nodeId, nodeId));

    const result = await db
      .select()
      .from(userNodeProgress)
      .where(and(...conditions));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/progress — create or update (upsert-like via app logic)
router.post("/", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.body;
    if (!userId || !nodeId)
      return res
        .status(400)
        .json({ error: "userId and nodeId are required" });

    // Check if progress record exists
    const existing = await db
      .select()
      .from(userNodeProgress)
      .where(
        and(
          eq(userNodeProgress.userId, userId),
          eq(userNodeProgress.nodeId, nodeId)
        )
      );

    const now = new Date().toISOString();

    if (existing.length) {
      // Update: bump lastEnteredAt and attemptsCount
      await db
        .update(userNodeProgress)
        .set({
          lastEnteredAt: now,
          attemptsCount: existing[0].attemptsCount + 1,
          updatedAt: now,
        })
        .where(eq(userNodeProgress.id, existing[0].id));
      const updated = await db
        .select()
        .from(userNodeProgress)
        .where(eq(userNodeProgress.id, existing[0].id));
      return res.json(updated[0]);
    }

    // Create new
    const id = uuid();
    await db.insert(userNodeProgress).values({
      id,
      userId,
      nodeId,
      firstEnteredAt: now,
      lastEnteredAt: now,
      attemptsCount: 1,
    });
    const created = await db
      .select()
      .from(userNodeProgress)
      .where(eq(userNodeProgress.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/progress/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { masteryScore, completedAt, hasGeneratedSubnodes } = req.body;
    await db
      .update(userNodeProgress)
      .set({
        ...(masteryScore !== undefined && { masteryScore }),
        ...(completedAt !== undefined && { completedAt }),
        ...(hasGeneratedSubnodes !== undefined && { hasGeneratedSubnodes }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userNodeProgress.id, req.params.id));
    const updated = await db
      .select()
      .from(userNodeProgress)
      .where(eq(userNodeProgress.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Progress record not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
