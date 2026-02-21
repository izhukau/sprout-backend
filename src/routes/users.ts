import { Router } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/users
router.get("/", async (_req, res, next) => {
  try {
    const result = await db.select().from(users);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/users/:id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.id));
    if (!result.length) return res.status(404).json({ error: "User not found" });
    res.json(result[0]);
  } catch (e) {
    next(e);
  }
});

// POST /api/users
router.post("/", async (req, res, next) => {
  try {
    const { email, title, desc } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    const id = uuid();
    await db.insert(users).values({ id, email, title, desc });
    const created = await db.select().from(users).where(eq(users.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { email, title, desc } = req.body;
    await db
      .update(users)
      .set({
        ...(email !== undefined && { email }),
        ...(title !== undefined && { title }),
        ...(desc !== undefined && { desc }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, req.params.id));
    const updated = await db
      .select()
      .from(users)
      .where(eq(users.id, req.params.id));
    if (!updated.length) return res.status(404).json({ error: "User not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
