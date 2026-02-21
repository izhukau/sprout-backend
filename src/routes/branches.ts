import { Router } from "express";
import { db } from "../db";
import { branches } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/branches?userId=
router.get("/", async (req, res, next) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId query param required" });
    const result = await db
      .select()
      .from(branches)
      .where(eq(branches.userId, userId));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/branches/:id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(branches)
      .where(eq(branches.id, req.params.id));
    if (!result.length) return res.status(404).json({ error: "Branch not found" });
    res.json(result[0]);
  } catch (e) {
    next(e);
  }
});

// POST /api/branches
router.post("/", async (req, res, next) => {
  try {
    const { title, userId } = req.body;
    if (!title || !userId)
      return res.status(400).json({ error: "title and userId are required" });
    const id = uuid();
    await db.insert(branches).values({ id, title, userId });
    const created = await db.select().from(branches).where(eq(branches.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/branches/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { title } = req.body;
    await db
      .update(branches)
      .set({ ...(title !== undefined && { title }), updatedAt: new Date().toISOString() })
      .where(eq(branches.id, req.params.id));
    const updated = await db
      .select()
      .from(branches)
      .where(eq(branches.id, req.params.id));
    if (!updated.length) return res.status(404).json({ error: "Branch not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/branches/:id
router.delete("/:id", async (req, res, next) => {
  try {
    await db.delete(branches).where(eq(branches.id, req.params.id));
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
