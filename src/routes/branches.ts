import { Router } from "express";
import { db } from "../db";
import {
  answers,
  assessments,
  branches,
  chatMessages,
  chatSessions,
  hintEvents,
  nodeContents,
  nodeEdges,
  nodeGenerations,
  nodes,
  questions,
  topicDocuments,
  userNodeProgress,
} from "../db/schema";
import { eq, inArray, or } from "drizzle-orm";
import { v4 as uuid } from "uuid";

const router = Router();

// GET /api/branches?userId=
router.get("/", async (req, res, next) => {
  try {
    const userId = req.query.userId as string;
    if (!userId)
      return res.status(400).json({ error: "userId query param required" });
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
    if (!result.length)
      return res.status(404).json({ error: "Branch not found" });
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
      .set({
        ...(title !== undefined && { title }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(branches.id, req.params.id));
    const updated = await db
      .select()
      .from(branches)
      .where(eq(branches.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Branch not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/branches/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const branchId = req.params.id;
    const existingBranch = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, branchId));
    if (!existingBranch.length) {
      return res.status(404).json({ error: "Branch not found" });
    }

    const branchNodes = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.branchId, branchId));

    const nodeIds = branchNodes.map((row) => row.id);
    if (!nodeIds.length) {
      await db.delete(branches).where(eq(branches.id, branchId));
      return res.status(204).send();
    }

    const assessmentRows = await db
      .select({ id: assessments.id })
      .from(assessments)
      .where(inArray(assessments.targetNodeId, nodeIds));
    const assessmentIds = assessmentRows.map((row) => row.id);

    const questionRows = assessmentIds.length
      ? await db
          .select({ id: questions.id })
          .from(questions)
          .where(inArray(questions.assessmentId, assessmentIds))
      : [];
    const questionIds = questionRows.map((row) => row.id);

    await db.delete(hintEvents).where(inArray(hintEvents.nodeId, nodeIds));

    const sessionRows = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(inArray(chatSessions.nodeId, nodeIds));
    const sessionIds = sessionRows.map((row) => row.id);

    if (sessionIds.length) {
      await db
        .delete(chatMessages)
        .where(inArray(chatMessages.sessionId, sessionIds));
    }
    await db.delete(chatSessions).where(inArray(chatSessions.nodeId, nodeIds));

    if (assessmentIds.length || questionIds.length) {
      const answerConditions = [];
      if (assessmentIds.length) {
        answerConditions.push(inArray(answers.assessmentId, assessmentIds));
      }
      if (questionIds.length) {
        answerConditions.push(inArray(answers.questionId, questionIds));
      }
      await db.delete(answers).where(or(...answerConditions));
    }

    if (assessmentIds.length) {
      await db
        .delete(questions)
        .where(inArray(questions.assessmentId, assessmentIds));
    }
    await db
      .delete(assessments)
      .where(inArray(assessments.targetNodeId, nodeIds));

    await db
      .delete(userNodeProgress)
      .where(inArray(userNodeProgress.nodeId, nodeIds));
    await db.delete(nodeContents).where(inArray(nodeContents.nodeId, nodeIds));
    await db
      .delete(nodeGenerations)
      .where(inArray(nodeGenerations.nodeId, nodeIds));
    await db
      .delete(topicDocuments)
      .where(inArray(topicDocuments.nodeId, nodeIds));
    await db
      .delete(nodeEdges)
      .where(
        or(
          inArray(nodeEdges.sourceNodeId, nodeIds),
          inArray(nodeEdges.targetNodeId, nodeIds),
        ),
      );
    await db.delete(nodes).where(inArray(nodes.id, nodeIds));
    await db.delete(branches).where(eq(branches.id, branchId));

    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
