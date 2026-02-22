import { Router } from "express";
import { db } from "../db";
import { assessments, questions, answers } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/assessments?userId=&targetNodeId=
router.get("/", async (req, res, next) => {
  try {
    const { userId, targetNodeId } = req.query as Record<string, string>;
    const conditions = [];
    if (userId) conditions.push(eq(assessments.userId, userId));
    if (targetNodeId) conditions.push(eq(assessments.targetNodeId, targetNodeId));
    const query = conditions.length
      ? db.select().from(assessments).where(and(...conditions))
      : db.select().from(assessments);
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/assessments/:id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, req.params.id));
    if (!result.length)
      return res.status(404).json({ error: "Assessment not found" });
    res.json(result[0]);
  } catch (e) {
    next(e);
  }
});

// POST /api/assessments
router.post("/", async (req, res, next) => {
  try {
    const { userId, targetNodeId, type, title } = req.body;
    if (!userId || !targetNodeId)
      return res
        .status(400)
        .json({ error: "userId and targetNodeId are required" });
    const id = uuid();
    await db.insert(assessments).values({
      id,
      userId,
      targetNodeId,
      type: type || "diagnostic",
      title: title || null,
    });
    const created = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/assessments/:id (mark complete, etc.)
router.patch("/:id", async (req, res, next) => {
  try {
    const { completedAt, title } = req.body;
    await db
      .update(assessments)
      .set({
        ...(completedAt !== undefined && { completedAt }),
        ...(title !== undefined && { title }),
      })
      .where(eq(assessments.id, req.params.id));
    const updated = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Assessment not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// --- Questions ---

// GET /api/assessments/:id/questions
router.get("/:id/questions", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, req.params.id));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/assessments/:id/questions
router.post("/:id/questions", async (req, res, next) => {
  try {
    const {
      nodeId,
      format,
      prompt,
      options,
      correctAnswer,
      gradingRubric,
      difficulty,
    } = req.body;
    if (!format || !prompt)
      return res.status(400).json({ error: "format and prompt are required" });
    const id = uuid();
    await db.insert(questions).values({
      id,
      assessmentId: req.params.id,
      nodeId: nodeId || null,
      format,
      prompt,
      options: options ? JSON.stringify(options) : null,
      correctAnswer: correctAnswer || null,
      gradingRubric: gradingRubric ? JSON.stringify(gradingRubric) : null,
      difficulty: difficulty || 1,
    });
    const created = await db
      .select()
      .from(questions)
      .where(eq(questions.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// --- Answers ---

// POST /api/assessments/:assessmentId/answers
router.post("/:assessmentId/answers", async (req, res, next) => {
  try {
    const { userId, questionId, answerText, selectedOption, isCorrect, score, feedback } =
      req.body;
    if (!userId || !questionId)
      return res
        .status(400)
        .json({ error: "userId and questionId are required" });
    const id = uuid();
    await db.insert(answers).values({
      id,
      userId,
      assessmentId: req.params.assessmentId,
      questionId,
      answerText: answerText || null,
      selectedOption: selectedOption || null,
      isCorrect: isCorrect ?? null,
      score: score ?? null,
      feedback: feedback || null,
    });
    const created = await db
      .select()
      .from(answers)
      .where(eq(answers.id, id));

    // Auto-complete assessment when all questions have been answered
    const assessmentRow = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, req.params.assessmentId));
    if (assessmentRow.length && !assessmentRow[0].completedAt) {
      const allQuestions = await db
        .select()
        .from(questions)
        .where(eq(questions.assessmentId, req.params.assessmentId));
      const allAnswers = await db
        .select()
        .from(answers)
        .where(
          and(
            eq(answers.assessmentId, req.params.assessmentId),
            eq(answers.userId, userId),
          ),
        );
      const answeredIds = new Set(allAnswers.map((a) => a.questionId));
      const unanswered = allQuestions.filter((q) => !answeredIds.has(q.id));
      if (unanswered.length === 0 && allQuestions.length > 0) {
        await db
          .update(assessments)
          .set({ completedAt: new Date().toISOString() })
          .where(eq(assessments.id, req.params.assessmentId));
      }
    }

    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// GET /api/assessments/:assessmentId/answers?userId=
router.get("/:assessmentId/answers", async (req, res, next) => {
  try {
    const userId = req.query.userId as string;
    const conditions = [eq(answers.assessmentId, req.params.assessmentId)];
    if (userId) conditions.push(eq(answers.userId, userId));
    const result = await db
      .select()
      .from(answers)
      .where(and(...conditions));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
