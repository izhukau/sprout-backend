import { Router } from "express";
import { db } from "../db";
import {
  nodes,
  userNodeProgress,
  nodeGenerations,
  nodeEdges,
  assessments,
  questions,
  answers,
} from "../db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import {
  generateSubconcepts,
  type SubconceptGenerationDiagnostic,
} from "../agents/generate-subconcepts";
import { generateConcepts } from "../agents/generate-concepts";

const router = Router();

function normalizeScore(
  rawScore: number | null,
  isCorrect: boolean | null,
): number | null {
  if (rawScore === null || rawScore === undefined) {
    if (isCorrect === true) return 1;
    if (isCorrect === false) return 0;
    return null;
  }

  // Some clients can send score in 0..100 range; normalize to 0..1 for prompt consistency.
  const normalized = rawScore > 1 ? rawScore / 100 : rawScore;
  return Math.max(0, Math.min(1, normalized));
}

async function loadDiagnosticForSubconceptGeneration(
  userId: string,
  nodeId: string,
): Promise<SubconceptGenerationDiagnostic | null> {
  const diagnosticAssessments = await db
    .select()
    .from(assessments)
    .where(
      and(
        eq(assessments.userId, userId),
        eq(assessments.targetNodeId, nodeId),
        eq(assessments.type, "diagnostic"),
      ),
    )
    .orderBy(desc(assessments.createdAt));

  if (!diagnosticAssessments.length) return null;

  const latestAssessment = diagnosticAssessments[0];
  const [assessmentQuestions, assessmentAnswers] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, latestAssessment.id)),
    db
      .select()
      .from(answers)
      .where(
        and(
          eq(answers.assessmentId, latestAssessment.id),
          eq(answers.userId, userId),
        ),
      ),
  ]);

  const latestAnswerByQuestionId = new Map<
    string,
    (typeof assessmentAnswers)[number]
  >();
  const sortedAnswers = [...assessmentAnswers].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  for (const answer of sortedAnswers) {
    latestAnswerByQuestionId.set(answer.questionId, answer);
  }

  const items = assessmentQuestions.map((question) => {
    const answer = latestAnswerByQuestionId.get(question.id);
    const studentAnswer = answer?.answerText ?? answer?.selectedOption ?? null;

    let isCorrect = answer?.isCorrect ?? null;
    if (
      isCorrect === null &&
      question.format === "mcq" &&
      answer?.selectedOption &&
      question.correctAnswer
    ) {
      isCorrect = answer.selectedOption === question.correctAnswer;
    }

    const score = normalizeScore(answer?.score ?? null, isCorrect);

    return {
      questionId: question.id,
      prompt: question.prompt,
      format: question.format,
      difficulty: question.difficulty,
      studentAnswer,
      correctAnswer: question.correctAnswer ?? null,
      isCorrect,
      score,
      feedback: answer?.feedback ?? null,
    };
  });

  const answeredCount = items.filter(
    (item) => item.studentAnswer && item.studentAnswer.trim().length > 0,
  ).length;

  const scoredItems = items.filter((item) => item.score !== null);
  const overallScore = scoredItems.length
    ? Number(
        (
          scoredItems.reduce((sum, item) => sum + (item.score ?? 0), 0) /
          scoredItems.length
        ).toFixed(3),
      )
    : null;

  const strengths = items
    .filter((item) =>
      item.score !== null ? item.score >= 0.7 : item.isCorrect === true,
    )
    .map((item) => item.prompt)
    .slice(0, 6);

  const gaps = items
    .filter((item) =>
      item.score !== null ? item.score < 0.7 : item.isCorrect === false,
    )
    .map((item) => item.prompt)
    .slice(0, 8);

  return {
    assessmentId: latestAssessment.id,
    answeredCount,
    totalQuestions: assessmentQuestions.length,
    overallScore,
    strengths,
    gaps,
    items,
  };
}

// GET /api/nodes?userId=&type=&branchId=&parentId=
router.get("/", async (req, res, next) => {
  try {
    const { userId, type, branchId, parentId } = req.query as Record<
      string,
      string
    >;
    const conditions = [];
    if (userId) conditions.push(eq(nodes.userId, userId));
    if (type) conditions.push(eq(nodes.type, type as any));
    if (branchId) conditions.push(eq(nodes.branchId, branchId));
    if (parentId) conditions.push(eq(nodes.parentId, parentId));

    const query = conditions.length
      ? db.select().from(nodes).where(and(...conditions))
      : db.select().from(nodes);
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/nodes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.id));
    if (!result.length)
      return res.status(404).json({ error: "Node not found" });
    res.json(result[0]);
  } catch (e) {
    next(e);
  }
});

// GET /api/nodes/:id/children
router.get("/:id/children", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(nodes)
      .where(eq(nodes.parentId, req.params.id));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/nodes/:id/dependency-edges?childType=concept|subconcept
// Returns dependency edges between direct children of a parent node.
router.get("/:id/dependency-edges", async (req, res, next) => {
  try {
    const childType = req.query.childType as
      | "concept"
      | "subconcept"
      | undefined;

    const childConditions = [eq(nodes.parentId, req.params.id)];
    if (childType) {
      childConditions.push(eq(nodes.type, childType));
    }

    const children = await db
      .select()
      .from(nodes)
      .where(and(...childConditions));
    const childIds = children.map((child) => child.id);
    if (!childIds.length) return res.json([]);

    const childIdSet = new Set(childIds);
    const outgoing = await db
      .select()
      .from(nodeEdges)
      .where(inArray(nodeEdges.sourceNodeId, childIds));

    const edges = outgoing.filter((edge) => childIdSet.has(edge.targetNodeId));
    res.json(edges);
  } catch (e) {
    next(e);
  }
});

// POST /api/nodes
router.post("/", async (req, res, next) => {
  try {
    const { userId, type, branchId, parentId, title, desc } = req.body;
    if (!userId || !type || !title)
      return res
        .status(400)
        .json({ error: "userId, type, and title are required" });
    const id = uuid();
    await db.insert(nodes).values({
      id,
      userId,
      type,
      branchId: branchId || null,
      parentId: parentId || null,
      title,
      desc: desc || null,
    });
    const created = await db.select().from(nodes).where(eq(nodes.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/nodes/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { title, desc, accuracyScore } = req.body;
    await db
      .update(nodes)
      .set({
        ...(title !== undefined && { title }),
        ...(desc !== undefined && { desc }),
        ...(accuracyScore !== undefined && { accuracyScore }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(nodes.id, req.params.id));
    const updated = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Node not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/nodes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    await db.delete(nodes).where(eq(nodes.id, req.params.id));
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// POST /api/nodes/:id/generate-subconcepts
// Calls Claude to generate subconcepts from a concept node.
// Requires userId in body to associate subconcepts with the user.
router.post("/:id/generate-subconcepts", async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // 1. Find the concept node
    const nodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.id));
    if (!nodeResult.length)
      return res.status(404).json({ error: "Node not found" });

    const node = nodeResult[0];

    // 2. Check if subconcepts have already been generated
    const progress = await db
      .select()
      .from(userNodeProgress)
      .where(
        and(
          eq(userNodeProgress.userId, userId),
          eq(userNodeProgress.nodeId, node.id),
        ),
      );

    if (progress.length && progress[0].hasGeneratedSubnodes) {
      // Already generated — return existing children and their edges
      const children = await db
        .select()
        .from(nodes)
        .where(eq(nodes.parentId, node.id));
      const childIds = children.map((c) => c.id);
      const edges = childIds.length
        ? await db.select().from(nodeEdges).where(
            eq(nodeEdges.sourceNodeId, childIds[0]), // get all edges for these nodes
          )
        : [];
      // Fetch all edges where source or target is one of the children
      const allEdges = [];
      for (const childId of childIds) {
        const srcEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.sourceNodeId, childId));
        allEdges.push(...srcEdges);
      }
      return res.json({
        generated: false,
        subconcepts: children,
        edges: allEdges,
      });
    }

    // 3. Get parent topic title for prompt context
    let parentTopicTitle: string | null = null;
    if (node.parentId) {
      const parent = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, node.parentId));
      if (parent.length) parentTopicTitle = parent[0].title;
    }

    // 4. Collect diagnostic context (request payload has priority over DB fallback)
    const rawDiagnostic =
      req.body.diagnostic ?? req.body.diagnosticSummary ?? null;
    const requestDiagnostic =
      rawDiagnostic && typeof rawDiagnostic === "object"
        ? (rawDiagnostic as SubconceptGenerationDiagnostic)
        : null;
    const diagnosticContext =
      requestDiagnostic ??
      (await loadDiagnosticForSubconceptGeneration(userId, node.id));

    // 5. Call Claude to generate subconcepts
    const subconcepts = await generateSubconcepts(
      node.title,
      node.desc,
      parentTopicTitle,
      diagnosticContext,
    );

    // 6. Save subconcepts to DB
    const titleToId: Record<string, string> = {};
    const createdNodes = [];
    for (const sc of subconcepts) {
      const id = uuid();
      await db.insert(nodes).values({
        id,
        userId,
        type: "subconcept",
        branchId: node.branchId,
        parentId: node.id,
        title: sc.title,
        desc: sc.desc,
      });
      titleToId[sc.title] = id;
      const created = await db.select().from(nodes).where(eq(nodes.id, id));
      createdNodes.push(created[0]);
    }

    // 6b. Create dependency edges between subconcepts
    const createdEdges = [];
    for (const sc of subconcepts) {
      for (const depTitle of sc.depends_on) {
        const sourceId = titleToId[depTitle];
        const targetId = titleToId[sc.title];
        if (sourceId && targetId) {
          const edgeId = uuid();
          await db.insert(nodeEdges).values({
            id: edgeId,
            sourceNodeId: sourceId, // prerequisite
            targetNodeId: targetId, // depends on prerequisite
          });
          createdEdges.push({ source: depTitle, target: sc.title });
        }
      }
    }

    // 7. Log the generation event
    await db.insert(nodeGenerations).values({
      id: uuid(),
      nodeId: node.id,
      trigger: "on_first_enter",
      model: "claude-sonnet-4-6",
      prompt: `Generate subconcepts for: ${node.title}`,
      responseMeta: JSON.stringify({
        count: subconcepts.length,
        usedDiagnostic: !!diagnosticContext,
        diagnosticAssessmentId: diagnosticContext?.assessmentId ?? null,
      }),
    });

    // 8. Update or create progress record
    const now = new Date().toISOString();
    if (progress.length) {
      await db
        .update(userNodeProgress)
        .set({ hasGeneratedSubnodes: true, updatedAt: now })
        .where(eq(userNodeProgress.id, progress[0].id));
    } else {
      await db.insert(userNodeProgress).values({
        id: uuid(),
        userId,
        nodeId: node.id,
        firstEnteredAt: now,
        lastEnteredAt: now,
        attemptsCount: 1,
        hasGeneratedSubnodes: true,
      });
    }

    res.status(201).json({
      generated: true,
      subconcepts: createdNodes,
      edges: createdEdges,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/nodes/:id/generate-concepts
// Generates a linear educational path of concepts for a root/topic node.
// Creates concept nodes as children + linear edges between them.
router.post("/:id/generate-concepts", async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // 1. Find the topic node
    const nodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.id));
    if (!nodeResult.length)
      return res.status(404).json({ error: "Node not found" });

    const node = nodeResult[0];

    // 2. Check if concepts have already been generated
    const existingChildren = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.parentId, node.id), eq(nodes.type, "concept")));

    if (existingChildren.length) {
      // Already generated — return existing concepts and edges
      const allEdges = [];
      for (const child of existingChildren) {
        const srcEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.sourceNodeId, child.id));
        allEdges.push(...srcEdges);
      }
      return res.json({
        generated: false,
        concepts: existingChildren,
        edges: allEdges,
      });
    }

    // 3. Call Claude to generate the linear path
    const concepts = await generateConcepts(node.title, node.desc);

    // 4. Save concept nodes to DB
    const createdNodes = [];
    for (const c of concepts) {
      const id = uuid();
      await db.insert(nodes).values({
        id,
        userId,
        type: "concept",
        branchId: node.branchId,
        parentId: node.id,
        title: c.title,
        desc: c.desc,
      });
      const created = await db.select().from(nodes).where(eq(nodes.id, id));
      createdNodes.push(created[0]);
    }

    // 5. Create linear edges: concept[0] -> concept[1] -> concept[2] -> ...
    const createdEdges = [];
    for (let i = 0; i < createdNodes.length - 1; i++) {
      const edgeId = uuid();
      await db.insert(nodeEdges).values({
        id: edgeId,
        sourceNodeId: createdNodes[i].id,
        targetNodeId: createdNodes[i + 1].id,
      });
      createdEdges.push({
        source: createdNodes[i].title,
        target: createdNodes[i + 1].title,
      });
    }

    // 6. Log the generation event
    await db.insert(nodeGenerations).values({
      id: uuid(),
      nodeId: node.id,
      trigger: "on_first_enter",
      model: "claude-sonnet-4-6",
      prompt: `Generate educational path for: ${node.title}`,
      responseMeta: JSON.stringify({ count: concepts.length }),
    });

    res
      .status(201)
      .json({ generated: true, concepts: createdNodes, edges: createdEdges });
  } catch (e) {
    next(e);
  }
});

export default router;
