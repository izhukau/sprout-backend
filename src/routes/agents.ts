import { Router } from "express";
import { db } from "../db";
import {
  nodes,
  nodeEdges,
  nodeGenerations,
  userNodeProgress,
  assessments,
  questions,
  answers,
} from "../db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { runTopicAgent } from "../agents/topic-agent";
import { runSubconceptBootstrapAgent } from "../agents/subconcept-bootstrap-agent";
import { runConceptRefinementAgent } from "../agents/concept-agent";
import { generateDiagnosticQuestions } from "../agents/generate-diagnostic";
import { type SubconceptGenerationDiagnostic } from "../agents/generate-subconcepts";
import {
  reviewLearningPath,
  type ConceptReviewAddition,
  type SubconceptReviewAddition,
} from "../agents/review-learning-path";
import { initSSE } from "../utils/sse";
import pLimit from "p-limit";

const router = Router();

type NodeRow = typeof nodes.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

type DiagnosticBundle = {
  assessment: typeof assessments.$inferSelect;
  assessmentQuestions: QuestionRow[];
  latestByQuestion: Map<string, AnswerRow>;
  answeredCount: number;
  requiredAnswers: number;
  parentTopicTitle: string | null;
  isComplete: boolean;
};

function normalizeScore(
  rawScore: number | null,
  isCorrect: boolean | null,
): number | null {
  if (rawScore === null || rawScore === undefined) {
    if (isCorrect === true) return 1;
    if (isCorrect === false) return 0;
    return null;
  }

  const normalized = rawScore > 1 ? rawScore / 100 : rawScore;
  return Math.max(0, Math.min(1, normalized));
}

function extractStudentAnswer(answer?: AnswerRow): string | null {
  const raw = answer?.answerText ?? answer?.selectedOption ?? null;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

async function ensureDiagnosticBundle(
  userId: string,
  conceptNode: NodeRow,
  parentTopicTitle: string | null,
): Promise<DiagnosticBundle> {
  const existingAssessments = await db
    .select()
    .from(assessments)
    .where(
      and(
        eq(assessments.userId, userId),
        eq(assessments.targetNodeId, conceptNode.id),
        eq(assessments.type, "diagnostic"),
      ),
    )
    .orderBy(desc(assessments.createdAt));

  let assessment: (typeof existingAssessments)[0];
  let assessmentQuestions: QuestionRow[];

  if (existingAssessments.length) {
    assessment = existingAssessments[0];
    assessmentQuestions = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id));
  } else {
    const assessmentId = uuid();
    await db.insert(assessments).values({
      id: assessmentId,
      userId,
      targetNodeId: conceptNode.id,
      type: "diagnostic",
      title: `Diagnostic for ${conceptNode.title}`,
    });

    const generatedQuestions = await generateDiagnosticQuestions(
      conceptNode.title,
      conceptNode.desc,
      parentTopicTitle,
    );

    for (const q of generatedQuestions) {
      await db.insert(questions).values({
        id: uuid(),
        assessmentId,
        nodeId: conceptNode.id,
        format: q.format,
        prompt: q.prompt,
        options: q.options ? JSON.stringify(q.options) : null,
        correctAnswer: q.correctAnswer,
        difficulty: q.difficulty,
      });
    }

    const created = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId));
    assessment = created[0];
    assessmentQuestions = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessmentId));
  }

  const assessmentAnswers = await db
    .select()
    .from(answers)
    .where(
      and(eq(answers.assessmentId, assessment.id), eq(answers.userId, userId)),
    );
  const latestByQuestion = latestAnswersByQuestion(assessmentAnswers);

  const answeredCount = assessmentQuestions.filter((question) => {
    const answer = latestByQuestion.get(question.id);
    return !!extractStudentAnswer(answer);
  }).length;

  const requiredAnswers = assessmentQuestions.length;
  const isComplete =
    !!assessment.completedAt ||
    (assessmentQuestions.length > 0 && answeredCount >= assessmentQuestions.length);

  return {
    assessment,
    assessmentQuestions,
    latestByQuestion,
    answeredCount,
    requiredAnswers,
    parentTopicTitle,
    isComplete,
  };
}

function latestAnswersByQuestion(
  assessmentAnswers: AnswerRow[],
): Map<string, AnswerRow> {
  const latest = new Map<string, AnswerRow>();
  const sorted = [...assessmentAnswers].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  for (const answer of sorted) {
    latest.set(answer.questionId, answer);
  }

  return latest;
}

function buildDiagnosticSummary(
  assessmentId: string,
  assessmentQuestions: QuestionRow[],
  latestByQuestion: Map<string, AnswerRow>,
): SubconceptGenerationDiagnostic {
  const items = assessmentQuestions.map((question) => {
    const answer = latestByQuestion.get(question.id);
    const studentAnswer = extractStudentAnswer(answer);

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
    .slice(0, 8);

  const gaps = items
    .filter((item) =>
      item.score !== null ? item.score < 0.7 : item.isCorrect === false,
    )
    .map((item) => item.prompt)
    .slice(0, 10);

  return {
    assessmentId,
    answeredCount,
    totalQuestions: assessmentQuestions.length,
    overallScore,
    strengths,
    gaps,
    items,
  };
}

// prepareDocumentContext moved to src/agents/topic-agent.ts

function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

async function loadLatestDiagnosticSummary(
  userId: string,
  nodeId: string,
): Promise<SubconceptGenerationDiagnostic | null> {
  const latestAssessments = await db
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

  if (!latestAssessments.length) return null;

  const assessment = latestAssessments[0];
  const [assessmentQuestions, assessmentAnswers] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, assessment.id)),
    db
      .select()
      .from(answers)
      .where(
        and(
          eq(answers.assessmentId, assessment.id),
          eq(answers.userId, userId),
        ),
      ),
  ]);

  const latestByQuestion = latestAnswersByQuestion(assessmentAnswers);
  return buildDiagnosticSummary(
    assessment.id,
    assessmentQuestions,
    latestByQuestion,
  );
}

async function loadSiblingGraph(currentNode: NodeRow): Promise<{
  siblingNodes: NodeRow[];
  siblingEdges: { source: string; target: string }[];
}> {
  if (!currentNode.parentId) {
    return { siblingNodes: [currentNode], siblingEdges: [] };
  }

  const siblingNodes = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.parentId, currentNode.parentId),
        eq(nodes.type, currentNode.type),
      ),
    );

  const siblingIds = siblingNodes.map((node) => node.id);
  if (!siblingIds.length) {
    return { siblingNodes, siblingEdges: [] };
  }

  const siblingIdSet = new Set(siblingIds);
  const titleById = new Map(siblingNodes.map((node) => [node.id, node.title]));
  const rawEdges = await db
    .select()
    .from(nodeEdges)
    .where(inArray(nodeEdges.sourceNodeId, siblingIds));

  const siblingEdges = rawEdges
    .filter((edge) => siblingIdSet.has(edge.targetNodeId))
    .map((edge) => ({
      source: titleById.get(edge.sourceNodeId) ?? edge.sourceNodeId,
      target: titleById.get(edge.targetNodeId) ?? edge.targetNodeId,
    }));

  return { siblingNodes, siblingEdges };
}

async function buildOverviewForNodeReview(
  userId: string,
  currentNode: NodeRow,
  rawOverview?: string | null,
): Promise<string> {
  const overviewLines: string[] = [];
  const userOverview = rawOverview?.trim();
  if (userOverview) {
    overviewLines.push(`User overview: ${userOverview}`);
  }

  const progress = await db
    .select()
    .from(userNodeProgress)
    .where(
      and(
        eq(userNodeProgress.userId, userId),
        eq(userNodeProgress.nodeId, currentNode.id),
      ),
    );

  if (progress.length) {
    const p = progress[0];
    overviewLines.push(
      `Progress: masteryScore=${p.masteryScore}, attempts=${p.attemptsCount}, completedAt=${p.completedAt ?? "null"}`,
    );
  }

  const nodeDiagnostic = await loadLatestDiagnosticSummary(
    userId,
    currentNode.id,
  );
  if (nodeDiagnostic) {
    overviewLines.push(
      `Current node diagnostic: overallScore=${nodeDiagnostic.overallScore ?? "null"}, answered=${nodeDiagnostic.answeredCount}/${nodeDiagnostic.totalQuestions}`,
    );
    if (nodeDiagnostic.strengths.length) {
      overviewLines.push(`Strengths: ${nodeDiagnostic.strengths.join(" | ")}`);
    }
    if (nodeDiagnostic.gaps.length) {
      overviewLines.push(`Gaps: ${nodeDiagnostic.gaps.join(" | ")}`);
    }
  }

  if (currentNode.type === "subconcept" && currentNode.parentId) {
    const parentConceptResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, currentNode.parentId));
    if (parentConceptResult.length) {
      overviewLines.push(`Parent concept: ${parentConceptResult[0].title}`);
      const parentDiagnostic = await loadLatestDiagnosticSummary(
        userId,
        parentConceptResult[0].id,
      );
      if (parentDiagnostic) {
        overviewLines.push(
          `Parent concept diagnostic: overallScore=${parentDiagnostic.overallScore ?? "null"}, gapsCount=${parentDiagnostic.gaps.length}`,
        );
      }
    }
  }

  if (!overviewLines.length) {
    return "No additional overview available.";
  }

  return overviewLines.join("\n");
}

async function createEdgeIfMissing(sourceNodeId: string, targetNodeId: string) {
  const existing = await db
    .select()
    .from(nodeEdges)
    .where(
      and(
        eq(nodeEdges.sourceNodeId, sourceNodeId),
        eq(nodeEdges.targetNodeId, targetNodeId),
      ),
    );

  if (existing.length) return;

  await db.insert(nodeEdges).values({
    id: uuid(),
    sourceNodeId,
    targetNodeId,
  });
}

// ensureTopicConceptGraph replaced by Topic Agent (src/agents/topic-agent.ts)

interface ConceptInsertionCandidate {
  title: string;
  desc: string;
  insertAfterTitle?: string | null;
}

async function insertConceptAdditions(
  userId: string,
  currentConcept: NodeRow,
  candidates: ConceptInsertionCandidate[],
): Promise<{
  insertedConcepts: NodeRow[];
  createdEdges: { source: string; target: string }[];
}> {
  if (!currentConcept.parentId || !candidates.length) {
    return { insertedConcepts: [], createdEdges: [] };
  }

  const siblingConcepts = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.parentId, currentConcept.parentId),
        eq(nodes.type, "concept"),
      ),
    );

  const workingNodes = [...siblingConcepts];
  const byId = new Map(workingNodes.map((node) => [node.id, node]));
  const byTitle = new Map(
    workingNodes.map((node) => [titleKey(node.title), node]),
  );
  const existingTitleSet = new Set(
    workingNodes.map((node) => titleKey(node.title)),
  );
  const anchorTailById = new Map<string, string>();

  const deduped: ConceptInsertionCandidate[] = [];
  const seenTitles = new Set<string>();
  for (const candidate of candidates) {
    const cleanTitle = candidate.title.trim();
    const cleanDesc = candidate.desc.trim();
    if (!cleanTitle || !cleanDesc) continue;
    const key = titleKey(cleanTitle);
    if (seenTitles.has(key) || existingTitleSet.has(key)) continue;
    seenTitles.add(key);
    deduped.push({
      title: cleanTitle,
      desc: cleanDesc,
      insertAfterTitle: candidate.insertAfterTitle?.trim() || null,
    });
  }

  if (!deduped.length) {
    return { insertedConcepts: [], createdEdges: [] };
  }

  const insertedConcepts: NodeRow[] = [];
  const createdEdges: { source: string; target: string }[] = [];

  for (const candidate of deduped) {
    const requestedAnchor =
      (candidate.insertAfterTitle &&
        byTitle.get(titleKey(candidate.insertAfterTitle))) ||
      currentConcept;
    const effectiveAnchorId =
      anchorTailById.get(requestedAnchor.id) ?? requestedAnchor.id;
    const effectiveAnchor = byId.get(effectiveAnchorId);
    if (!effectiveAnchor) continue;

    const conceptId = uuid();
    await db.insert(nodes).values({
      id: conceptId,
      userId,
      type: "concept",
      branchId: currentConcept.branchId,
      parentId: currentConcept.parentId,
      title: candidate.title,
      desc: candidate.desc,
    });

    const created = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, conceptId));
    const inserted = created[0];
    insertedConcepts.push(inserted);
    workingNodes.push(inserted);
    byId.set(inserted.id, inserted);
    byTitle.set(titleKey(inserted.title), inserted);

    const conceptIdSet = new Set(workingNodes.map((node) => node.id));
    const outgoing = await db
      .select()
      .from(nodeEdges)
      .where(eq(nodeEdges.sourceNodeId, effectiveAnchor.id));
    const outgoingConceptEdges = outgoing.filter(
      (edge) =>
        conceptIdSet.has(edge.targetNodeId) &&
        edge.targetNodeId !== inserted.id,
    );

    for (const edge of outgoingConceptEdges) {
      await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
    }

    await createEdgeIfMissing(effectiveAnchor.id, inserted.id);
    createdEdges.push({
      source: effectiveAnchor.title,
      target: inserted.title,
    });

    for (const edge of outgoingConceptEdges) {
      await createEdgeIfMissing(inserted.id, edge.targetNodeId);
      const targetTitle =
        byId.get(edge.targetNodeId)?.title ?? edge.targetNodeId;
      createdEdges.push({ source: inserted.title, target: targetTitle });
    }

    anchorTailById.set(requestedAnchor.id, inserted.id);
  }

  return { insertedConcepts, createdEdges };
}

async function insertSubconceptAdditions(
  userId: string,
  currentSubconcept: NodeRow,
  candidates: SubconceptReviewAddition[],
): Promise<{
  insertedSubconcepts: NodeRow[];
  createdEdges: { source: string; target: string }[];
}> {
  if (!currentSubconcept.parentId || !candidates.length) {
    return { insertedSubconcepts: [], createdEdges: [] };
  }

  const siblingSubconcepts = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.parentId, currentSubconcept.parentId),
        eq(nodes.type, "subconcept"),
      ),
    );

  const byId = new Map(siblingSubconcepts.map((node) => [node.id, node]));
  const byTitle = new Map(
    siblingSubconcepts.map((node) => [titleKey(node.title), node]),
  );
  const existingTitleSet = new Set(
    siblingSubconcepts.map((node) => titleKey(node.title)),
  );
  const seenTitles = new Set<string>();

  const deduped: SubconceptReviewAddition[] = [];
  for (const candidate of candidates) {
    const cleanTitle = candidate.title.trim();
    const cleanDesc = candidate.desc.trim();
    if (!cleanTitle || !cleanDesc) continue;
    const key = titleKey(cleanTitle);
    if (seenTitles.has(key) || existingTitleSet.has(key)) continue;
    seenTitles.add(key);
    deduped.push({
      title: cleanTitle,
      desc: cleanDesc,
      reason: candidate.reason,
      depends_on: Array.isArray(candidate.depends_on)
        ? candidate.depends_on
        : [],
      unlocks: Array.isArray(candidate.unlocks) ? candidate.unlocks : [],
    });
  }

  if (!deduped.length) {
    return { insertedSubconcepts: [], createdEdges: [] };
  }

  const insertedSubconcepts: NodeRow[] = [];
  const createdEdges: { source: string; target: string }[] = [];

  for (const candidate of deduped) {
    const subconceptId = uuid();
    await db.insert(nodes).values({
      id: subconceptId,
      userId,
      type: "subconcept",
      branchId: currentSubconcept.branchId,
      parentId: currentSubconcept.parentId,
      title: candidate.title,
      desc: candidate.desc,
    });

    const created = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, subconceptId));
    const inserted = created[0];
    insertedSubconcepts.push(inserted);
    byId.set(inserted.id, inserted);
    byTitle.set(titleKey(inserted.title), inserted);

    let dependsOnIds = candidate.depends_on
      .map((title) => byTitle.get(titleKey(title))?.id)
      .filter((id): id is string => !!id && id !== inserted.id);
    let unlockIds = candidate.unlocks
      .map((title) => byTitle.get(titleKey(title))?.id)
      .filter(
        (id): id is string =>
          !!id && id !== inserted.id && !dependsOnIds.includes(id),
      );

    if (!dependsOnIds.length && !unlockIds.length) {
      dependsOnIds = [currentSubconcept.id];
    }

    for (const depId of dependsOnIds) {
      await createEdgeIfMissing(depId, inserted.id);
      const sourceTitle = byId.get(depId)?.title ?? depId;
      createdEdges.push({ source: sourceTitle, target: inserted.title });
    }

    for (const unlockId of unlockIds) {
      await createEdgeIfMissing(inserted.id, unlockId);
      const targetTitle = byId.get(unlockId)?.title ?? unlockId;
      createdEdges.push({ source: inserted.title, target: targetTitle });
    }

    if (dependsOnIds.length && unlockIds.length) {
      for (const depId of dependsOnIds) {
        for (const unlockId of unlockIds) {
          const direct = await db
            .select()
            .from(nodeEdges)
            .where(
              and(
                eq(nodeEdges.sourceNodeId, depId),
                eq(nodeEdges.targetNodeId, unlockId),
              ),
            );
          for (const edge of direct) {
            await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
          }
        }
      }
    }
  }

  return { insertedSubconcepts, createdEdges };
}

// POST /api/agents/topics/:topicNodeId/run
router.post("/topics/:topicNodeId/run", async (req, res, next) => {
  try {
    const { userId, small } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const topicNodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.topicNodeId));
    if (!topicNodeResult.length) {
      return res.status(404).json({ error: "Topic node not found" });
    }

    const topicNode = topicNodeResult[0];

    // Init SSE stream
    const sse = initSSE(res);
    sse.registerAgent(); // Register the topic agent

    try {
      // Run Topic Agent — generates concepts with SSE streaming
      const topicResult = await runTopicAgent({
        userId,
        topicNode,
        sse,
        small: !!small,
      });

      // Immediately bootstrap subconcepts for each concept (concurrent limit 3)
      const limit = pLimit(3);
      const bootstrapPromises = topicResult.concepts.map((savedConcept) => {
        sse.registerAgent();
        return limit(async () => {
          try {
            await runSubconceptBootstrapAgent({
              userId,
              conceptNode: savedConcept.node,
              topicTitle: topicNode.title,
              documentContext: savedConcept.documentContext,
              sse,
              small: !!small,
              generateQuestions: true, // keep diagnostics for optional survey
            });
          } catch (err: any) {
            sse.send("agent_error", {
              agent: `subconcept_bootstrap:${savedConcept.node.title}`,
              message: err.message ?? "Bootstrap agent failed",
            });
          } finally {
            sse.resolveAgent();
          }
        });
      });

      await Promise.all(bootstrapPromises);

      sse.send("agent_done", {
        agent: "topic",
        conceptCount: topicResult.concepts.length,
        rationale: topicResult.rationale,
      });
    } catch (err: any) {
      sse.send("agent_error", {
        agent: "topic",
        message: err.message ?? "Topic agent failed",
      });
    } finally {
      sse.resolveAgent(); // Resolve the topic agent
    }
  } catch (e) {
    next(e);
  }
});

// GET /api/agents/concepts/:conceptNodeId/diagnostic (optional survey)
router.get("/concepts/:conceptNodeId/diagnostic", async (req, res, next) => {
  try {
    const userId = req.query.userId as string | undefined;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const conceptNodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.conceptNodeId));
    if (!conceptNodeResult.length) {
      return res.status(404).json({ error: "Concept node not found" });
    }
    const conceptNode = conceptNodeResult[0];
    if (conceptNode.type !== "concept") {
      return res.status(400).json({ error: "Node must be type=concept" });
    }

    let parentTopicTitle: string | null = null;
    if (conceptNode.parentId) {
      const parent = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, conceptNode.parentId));
      if (parent.length) parentTopicTitle = parent[0].title;
    }

    const bundle = await ensureDiagnosticBundle(
      userId,
      conceptNode,
      parentTopicTitle,
    );

    return res.json({
      agent: "concept",
      status: "diagnostic_ready",
      conceptNodeId: conceptNode.id,
      assessment: bundle.assessment,
      questions: bundle.assessmentQuestions,
      answeredCount: bundle.answeredCount,
      requiredAnswers: bundle.requiredAnswers,
      isComplete: bundle.isComplete,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/agents/concepts/:conceptNodeId/run
// Always streams refinement; diagnostic answers (if any) are included in context.
router.post("/concepts/:conceptNodeId/run", async (req, res, next) => {
  try {
    const { userId } = req.body as { userId?: string };
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const conceptNodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.conceptNodeId));
    if (!conceptNodeResult.length) {
      return res.status(404).json({ error: "Concept node not found" });
    }

    const conceptNode = conceptNodeResult[0];
    if (conceptNode.type !== "concept") {
      return res.status(400).json({ error: "Node must be type=concept" });
    }

    let parentTopicTitle: string | null = null;
    if (conceptNode.parentId) {
      const parent = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, conceptNode.parentId));
      if (parent.length) parentTopicTitle = parent[0].title;
    }

    const diagnostic = await ensureDiagnosticBundle(
      userId,
      conceptNode,
      parentTopicTitle,
    );

    const existingSubconcepts = await db
      .select()
      .from(nodes)
      .where(
        and(eq(nodes.parentId, conceptNode.id), eq(nodes.type, "subconcept")),
      );

    const sse = initSSE(res);

    // Inform frontend of diagnostic status (optional)
    sse.send("diagnostic_status", {
      conceptNodeId: conceptNode.id,
      assessment: diagnostic.assessment,
      answeredCount: diagnostic.answeredCount,
      requiredAnswers: diagnostic.requiredAnswers,
    });

    // Bootstrap subconcepts if missing (questions already exist)
    if (!existingSubconcepts.length) {
      sse.registerAgent();
      try {
        await runSubconceptBootstrapAgent({
          userId,
          conceptNode,
          topicTitle: parentTopicTitle ?? "Topic",
          documentContext: null,
          sse,
          small: false,
          generateQuestions: false,
        });
        sse.send("agent_done", {
          agent: `subconcept_bootstrap:${conceptNode.title}`,
        });
      } catch (err: any) {
        sse.send("agent_error", {
          agent: `subconcept_bootstrap:${conceptNode.title}`,
          message: err.message ?? "Subconcept bootstrap agent failed",
        });
      } finally {
        sse.resolveAgent();
      }
    }

    // Run refinement using whatever answers exist (possibly zero)
    sse.registerAgent();

    try {
      await runConceptRefinementAgent({
        userId,
        conceptNode,
        parentTopicTitle,
        assessmentId: diagnostic.assessment.id,
        assessmentQuestions: diagnostic.assessmentQuestions,
        latestByQuestion: diagnostic.latestByQuestion,
        sse,
      });

      sse.send("agent_done", { agent: "concept_refinement" });
    } catch (err: any) {
      sse.send("agent_error", {
        agent: "concept_refinement",
        message: err.message ?? "Concept refinement agent failed",
      });
    } finally {
      sse.resolveAgent();
    }
  } catch (e) {
    next(e);
  }
});

// POST /api/agents/nodes/:nodeId/review
// Run post-completion review and optionally enrich the graph with new nodes.
router.post("/nodes/:nodeId/review", async (req, res, next) => {
  try {
    const { userId, overview, maxAdditions } = req.body as {
      userId?: string;
      overview?: string;
      maxAdditions?: number;
    };

    if (!userId) return res.status(400).json({ error: "userId is required" });

    const nodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.nodeId));
    if (!nodeResult.length) {
      return res.status(404).json({ error: "Node not found" });
    }

    const currentNode = nodeResult[0];
    if (currentNode.type !== "concept" && currentNode.type !== "subconcept") {
      return res.status(400).json({
        error: "Review agent supports only concept or subconcept nodes",
      });
    }

    let topicTitle = "Current Topic";
    if (currentNode.type === "concept" && currentNode.parentId) {
      const topicResult = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, currentNode.parentId));
      if (topicResult.length) topicTitle = topicResult[0].title;
    }

    if (currentNode.type === "subconcept" && currentNode.parentId) {
      const parentConceptResult = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, currentNode.parentId));
      if (parentConceptResult.length) {
        const parentConcept = parentConceptResult[0];
        if (parentConcept.parentId) {
          const topicResult = await db
            .select()
            .from(nodes)
            .where(eq(nodes.id, parentConcept.parentId));
          topicTitle = topicResult.length
            ? topicResult[0].title
            : parentConcept.title;
        } else {
          topicTitle = parentConcept.title;
        }
      }
    }

    const { siblingNodes, siblingEdges } = await loadSiblingGraph(currentNode);
    const finalOverview = await buildOverviewForNodeReview(
      userId,
      currentNode,
      overview,
    );

    const reviewDecision = await reviewLearningPath({
      level: currentNode.type as "concept" | "subconcept",
      topicTitle,
      currentNodeTitle: currentNode.title,
      currentNodeDesc: currentNode.desc,
      overview: finalOverview,
      siblingNodes: siblingNodes.map((node) => ({
        title: node.title,
        desc: node.desc,
      })),
      siblingEdges,
      maxAdditions,
    });

    if (!reviewDecision.should_add) {
      return res.json({
        agent: "path_review",
        status: "no_change",
        nodeId: currentNode.id,
        level: currentNode.type,
        decision: reviewDecision,
        insertedNodes: [],
        createdEdges: [],
      });
    }

    if (currentNode.type === "concept") {
      const conceptAdditions = (reviewDecision.concept_additions ?? []).map(
        (item: ConceptReviewAddition) => ({
          title: item.title,
          desc: item.desc,
          insertAfterTitle: item.insert_after,
        }),
      );

      const insertionResult = await insertConceptAdditions(
        userId,
        currentNode,
        conceptAdditions,
      );

      if (insertionResult.insertedConcepts.length) {
        await db.insert(nodeGenerations).values({
          id: uuid(),
          nodeId: currentNode.id,
          trigger: "manual_regenerate",
          model: "claude-sonnet-4-6",
          prompt: `Post-completion concept review for: ${currentNode.title}`,
          responseMeta: JSON.stringify({
            mode: "path_review_agent",
            level: "concept",
            insertedCount: insertionResult.insertedConcepts.length,
            insertedTitles: insertionResult.insertedConcepts.map(
              (n) => n.title,
            ),
            notes: reviewDecision.notes ?? null,
          }),
        });
      }

      return res.json({
        agent: "path_review",
        status: insertionResult.insertedConcepts.length
          ? "updated"
          : "no_change",
        nodeId: currentNode.id,
        level: currentNode.type,
        decision: reviewDecision,
        insertedNodes: insertionResult.insertedConcepts,
        createdEdges: insertionResult.createdEdges,
      });
    }

    const subconceptAdditions = reviewDecision.subconcept_additions ?? [];
    const insertionResult = await insertSubconceptAdditions(
      userId,
      currentNode,
      subconceptAdditions as SubconceptReviewAddition[],
    );

    if (insertionResult.insertedSubconcepts.length) {
      await db.insert(nodeGenerations).values({
        id: uuid(),
        nodeId: currentNode.id,
        trigger: "manual_regenerate",
        model: "claude-sonnet-4-6",
        prompt: `Post-completion subconcept review for: ${currentNode.title}`,
        responseMeta: JSON.stringify({
          mode: "path_review_agent",
          level: "subconcept",
          insertedCount: insertionResult.insertedSubconcepts.length,
          insertedTitles: insertionResult.insertedSubconcepts.map(
            (n) => n.title,
          ),
          notes: reviewDecision.notes ?? null,
        }),
      });
    }

    return res.json({
      agent: "path_review",
      status: insertionResult.insertedSubconcepts.length
        ? "updated"
        : "no_change",
      nodeId: currentNode.id,
      level: currentNode.type,
      decision: reviewDecision,
      insertedNodes: insertionResult.insertedSubconcepts,
      createdEdges: insertionResult.createdEdges,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
