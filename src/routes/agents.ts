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
import { generateDiagnosticQuestions } from "../agents/generate-diagnostic";
import { gradeAnswers } from "../agents/grade-answers";
import {
  generateSubconcepts,
  type SubconceptGenerationDiagnostic,
} from "../agents/generate-subconcepts";
import {
  generateAdaptiveConcepts,
  type AdaptiveConceptCandidate,
} from "../agents/concept-agent";

const router = Router();

type NodeRow = typeof nodes.$inferSelect;
type EdgeRow = typeof nodeEdges.$inferSelect;
type AssessmentRow = typeof assessments.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

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

function latestAnswersByQuestion(assessmentAnswers: AnswerRow[]): Map<string, AnswerRow> {
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

async function ensureTopicConceptGraph(
  userId: string,
  topicNode: NodeRow,
): Promise<{
  generated: boolean;
  concepts: NodeRow[];
  edges: { source: string; target: string }[];
  rationale: string | null;
}> {
  const existingConcepts = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.parentId, topicNode.id), eq(nodes.type, "concept")));

  if (existingConcepts.length) {
    const edges: { source: string; target: string }[] = [];
    for (const concept of existingConcepts) {
      const out = await db
        .select()
        .from(nodeEdges)
        .where(eq(nodeEdges.sourceNodeId, concept.id));

      for (const edge of out) {
        const targetNode = existingConcepts.find((n) => n.id === edge.targetNodeId);
        if (targetNode) {
          edges.push({ source: concept.title, target: targetNode.title });
        }
      }
    }

    return {
      generated: false,
      concepts: existingConcepts,
      edges,
      rationale: null,
    };
  }

  const plan = await runTopicAgent(topicNode.title, topicNode.desc);
  const createdConcepts: NodeRow[] = [];

  for (const concept of plan.concepts) {
    const conceptId = uuid();
    await db.insert(nodes).values({
      id: conceptId,
      userId,
      type: "concept",
      branchId: topicNode.branchId,
      parentId: topicNode.id,
      title: concept.title,
      desc: concept.desc,
    });

    const created = await db.select().from(nodes).where(eq(nodes.id, conceptId));
    createdConcepts.push(created[0]);
  }

  const createdEdges: { source: string; target: string }[] = [];
  for (let i = 0; i < createdConcepts.length - 1; i++) {
    await createEdgeIfMissing(createdConcepts[i].id, createdConcepts[i + 1].id);
    createdEdges.push({
      source: createdConcepts[i].title,
      target: createdConcepts[i + 1].title,
    });
  }

  await db.insert(nodeGenerations).values({
    id: uuid(),
    nodeId: topicNode.id,
    trigger: "on_first_enter",
    model: "claude-sonnet-4-6",
    prompt: `Topic agent bootstrap for: ${topicNode.title}`,
    responseMeta: JSON.stringify({
      count: createdConcepts.length,
      mode: "topic_agent",
    }),
  });

  return {
    generated: true,
    concepts: createdConcepts,
    edges: createdEdges,
    rationale: plan.rationale,
  };
}

async function ensureDiagnosticAssessment(
  userId: string,
  conceptNode: NodeRow,
  parentTopicTitle: string | null,
): Promise<{ assessment: AssessmentRow; questions: QuestionRow[]; created: boolean }> {
  const existing = await db
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

  if (existing.length) {
    const existingQuestions = await db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, existing[0].id));

    return {
      assessment: existing[0],
      questions: existingQuestions,
      created: false,
    };
  }

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

  for (const question of generatedQuestions) {
    await db.insert(questions).values({
      id: uuid(),
      assessmentId,
      nodeId: conceptNode.id,
      format: question.format,
      prompt: question.prompt,
      options: question.options ? JSON.stringify(question.options) : null,
      correctAnswer: question.correctAnswer,
      difficulty: question.difficulty,
    });
  }

  const createdAssessment = await db
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId));
  const createdQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.assessmentId, assessmentId));

  return {
    assessment: createdAssessment[0],
    questions: createdQuestions,
    created: true,
  };
}

async function gradeDiagnosticAnswers(
  conceptTitle: string,
  assessmentQuestions: QuestionRow[],
  latestByQuestion: Map<string, AnswerRow>,
): Promise<number> {
  const gradable = assessmentQuestions
    .map((question) => {
      const answer = latestByQuestion.get(question.id);
      const studentAnswer = extractStudentAnswer(answer);
      if (!studentAnswer || !question.correctAnswer) return null;

      return {
        questionId: question.id,
        prompt: question.prompt,
        format: question.format,
        correctAnswer: question.correctAnswer,
        studentAnswer,
      };
    })
    .filter((item) => item !== null);

  if (!gradable.length) return 0;

  const graded = await gradeAnswers(conceptTitle, gradable);

  for (const result of graded) {
    const latestAnswer = latestByQuestion.get(result.questionId);
    if (!latestAnswer) continue;

    await db
      .update(answers)
      .set({
        isCorrect: result.isCorrect,
        score: result.score,
        feedback: result.feedback,
      })
      .where(eq(answers.id, latestAnswer.id));

    latestByQuestion.set(result.questionId, {
      ...latestAnswer,
      isCorrect: result.isCorrect,
      score: result.score,
      feedback: result.feedback,
    });
  }

  return graded.length;
}

async function ensureSubconceptGraph(
  userId: string,
  conceptNode: NodeRow,
  parentTopicTitle: string | null,
  diagnostic: SubconceptGenerationDiagnostic,
): Promise<{
  generated: boolean;
  subconcepts: NodeRow[];
  edges: { source: string; target: string }[];
}> {
  const progress = await db
    .select()
    .from(userNodeProgress)
    .where(
      and(
        eq(userNodeProgress.userId, userId),
        eq(userNodeProgress.nodeId, conceptNode.id),
      ),
    );

  if (progress.length && progress[0].hasGeneratedSubnodes) {
    const existingSubconcepts = await db
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.parentId, conceptNode.id),
          eq(nodes.type, "subconcept"),
        ),
      );

    const edges: { source: string; target: string }[] = [];
    const titleById = new Map(existingSubconcepts.map((node) => [node.id, node.title]));

    for (const subconcept of existingSubconcepts) {
      const out = await db
        .select()
        .from(nodeEdges)
        .where(eq(nodeEdges.sourceNodeId, subconcept.id));

      for (const edge of out) {
        const targetTitle = titleById.get(edge.targetNodeId);
        if (targetTitle) {
          edges.push({ source: subconcept.title, target: targetTitle });
        }
      }
    }

    return {
      generated: false,
      subconcepts: existingSubconcepts,
      edges,
    };
  }

  const generatedSubconcepts = await generateSubconcepts(
    conceptNode.title,
    conceptNode.desc,
    parentTopicTitle,
    diagnostic,
  );

  const titleToId: Record<string, string> = {};
  const createdNodes: NodeRow[] = [];
  for (const subconcept of generatedSubconcepts) {
    const subconceptId = uuid();
    await db.insert(nodes).values({
      id: subconceptId,
      userId,
      type: "subconcept",
      branchId: conceptNode.branchId,
      parentId: conceptNode.id,
      title: subconcept.title,
      desc: subconcept.desc,
    });
    titleToId[subconcept.title] = subconceptId;
    const created = await db.select().from(nodes).where(eq(nodes.id, subconceptId));
    createdNodes.push(created[0]);
  }

  const createdEdges: { source: string; target: string }[] = [];
  for (const subconcept of generatedSubconcepts) {
    for (const dependencyTitle of subconcept.depends_on) {
      const sourceId = titleToId[dependencyTitle];
      const targetId = titleToId[subconcept.title];
      if (!sourceId || !targetId) continue;
      await createEdgeIfMissing(sourceId, targetId);
      createdEdges.push({ source: dependencyTitle, target: subconcept.title });
    }
  }

  await db.insert(nodeGenerations).values({
    id: uuid(),
    nodeId: conceptNode.id,
    trigger: "on_first_enter",
    model: "claude-sonnet-4-6",
    prompt: `Concept agent subconcept graph for: ${conceptNode.title}`,
    responseMeta: JSON.stringify({
      count: createdNodes.length,
      mode: "concept_agent",
      diagnosticAssessmentId: diagnostic.assessmentId,
    }),
  });

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
      nodeId: conceptNode.id,
      firstEnteredAt: now,
      lastEnteredAt: now,
      attemptsCount: 1,
      hasGeneratedSubnodes: true,
    });
  }

  return {
    generated: true,
    subconcepts: createdNodes,
    edges: createdEdges,
  };
}

async function loadFutureConceptTitles(currentConcept: NodeRow): Promise<string[]> {
  if (!currentConcept.parentId) return [];

  const siblingConcepts = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.parentId, currentConcept.parentId),
        eq(nodes.type, "concept"),
      ),
    );

  if (siblingConcepts.length <= 1) return [];

  const conceptIds = siblingConcepts.map((node) => node.id);
  const conceptIdSet = new Set(conceptIds);
  const titleById = new Map(siblingConcepts.map((node) => [node.id, node.title]));

  const conceptEdges = await db
    .select()
    .from(nodeEdges)
    .where(inArray(nodeEdges.sourceNodeId, conceptIds));

  const adjacency = new Map<string, string[]>();
  for (const edge of conceptEdges) {
    if (!conceptIdSet.has(edge.targetNodeId)) continue;
    const out = adjacency.get(edge.sourceNodeId) || [];
    out.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, out);
  }

  const queue = [currentConcept.id];
  const visited = new Set<string>(queue);
  const futureIds: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    const next = adjacency.get(current) || [];
    for (const targetId of next) {
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      futureIds.push(targetId);
      queue.push(targetId);
    }
  }

  return futureIds
    .map((id) => titleById.get(id))
    .filter((title): title is string => !!title);
}

async function insertAdaptiveConceptsAfterCurrent(
  userId: string,
  currentConcept: NodeRow,
  candidates: AdaptiveConceptCandidate[],
): Promise<{ insertedConcepts: NodeRow[]; createdEdges: { source: string; target: string }[] }> {
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

  const existingTitleSet = new Set(
    siblingConcepts.map((node) => node.title.trim().toLowerCase()),
  );

  const deduped: AdaptiveConceptCandidate[] = [];
  const seenTitles = new Set<string>();
  for (const candidate of candidates) {
    const cleanTitle = candidate.title.trim();
    if (!cleanTitle) continue;
    const key = cleanTitle.toLowerCase();
    if (seenTitles.has(key) || existingTitleSet.has(key)) continue;
    seenTitles.add(key);
    deduped.push({
      title: cleanTitle,
      desc: candidate.desc,
      reason: candidate.reason,
    });
  }

  if (!deduped.length) {
    return { insertedConcepts: [], createdEdges: [] };
  }

  const conceptIdSet = new Set(siblingConcepts.map((node) => node.id));
  const siblingTitleById = new Map(siblingConcepts.map((node) => [node.id, node.title]));
  const outgoingFromCurrent = await db
    .select()
    .from(nodeEdges)
    .where(eq(nodeEdges.sourceNodeId, currentConcept.id));
  const outgoingConceptEdges = outgoingFromCurrent.filter((edge) =>
    conceptIdSet.has(edge.targetNodeId),
  );

  const insertedConcepts: NodeRow[] = [];
  for (const candidate of deduped) {
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
    const created = await db.select().from(nodes).where(eq(nodes.id, conceptId));
    insertedConcepts.push(created[0]);
  }

  for (const edge of outgoingConceptEdges) {
    await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
  }

  const createdEdges: { source: string; target: string }[] = [];
  let lastSourceId = currentConcept.id;
  let lastSourceTitle = currentConcept.title;

  for (const inserted of insertedConcepts) {
    await createEdgeIfMissing(lastSourceId, inserted.id);
    createdEdges.push({ source: lastSourceTitle, target: inserted.title });
    lastSourceId = inserted.id;
    lastSourceTitle = inserted.title;
  }

  for (const edge of outgoingConceptEdges) {
    await createEdgeIfMissing(lastSourceId, edge.targetNodeId);
    const targetTitle = siblingTitleById.get(edge.targetNodeId) ?? edge.targetNodeId;
    createdEdges.push({ source: lastSourceTitle, target: targetTitle });
  }

  return { insertedConcepts, createdEdges };
}

// POST /api/agents/topics/:topicNodeId/run
router.post("/topics/:topicNodeId/run", async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const topicNodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, req.params.topicNodeId));
    if (!topicNodeResult.length) {
      return res.status(404).json({ error: "Topic node not found" });
    }

    const topicNode = topicNodeResult[0];
    const result = await ensureTopicConceptGraph(userId, topicNode);

    res.json({
      agent: "topic",
      topicNodeId: topicNode.id,
      generatedConcepts: result.generated,
      rationale: result.rationale,
      concepts: result.concepts,
      edges: result.edges,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/agents/concepts/:conceptNodeId/run
router.post("/concepts/:conceptNodeId/run", async (req, res, next) => {
  try {
    const { userId, minAnsweredQuestions, maxAdaptiveConcepts } = req.body as {
      userId?: string;
      minAnsweredQuestions?: number;
      maxAdaptiveConcepts?: number;
    };

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

    const diagnosticState = await ensureDiagnosticAssessment(
      userId,
      conceptNode,
      parentTopicTitle,
    );

    const assessmentAnswers = await db
      .select()
      .from(answers)
      .where(
        and(
          eq(answers.assessmentId, diagnosticState.assessment.id),
          eq(answers.userId, userId),
        ),
      );
    const latestByQuestion = latestAnswersByQuestion(assessmentAnswers);

    const answeredCount = diagnosticState.questions.filter((question) => {
      const answer = latestByQuestion.get(question.id);
      return !!extractStudentAnswer(answer);
    }).length;

    const requiredAnswers = Math.max(1, Math.floor(minAnsweredQuestions ?? 1));

    if (answeredCount < requiredAnswers) {
      return res.json({
        agent: "concept",
        status: "awaiting_answers",
        conceptNodeId: conceptNode.id,
        assessment: diagnosticState.assessment,
        questions: diagnosticState.questions,
        answeredCount,
        requiredAnswers,
        createdDiagnostic: diagnosticState.created,
      });
    }

    const gradedCount = await gradeDiagnosticAnswers(
      conceptNode.title,
      diagnosticState.questions,
      latestByQuestion,
    );

    const diagnosticSummary = buildDiagnosticSummary(
      diagnosticState.assessment.id,
      diagnosticState.questions,
      latestByQuestion,
    );

    const subconceptGraph = await ensureSubconceptGraph(
      userId,
      conceptNode,
      parentTopicTitle,
      diagnosticSummary,
    );

    const futureConceptTitles = await loadFutureConceptTitles(conceptNode);
    const adaptiveCandidates = await generateAdaptiveConcepts({
      topicTitle: parentTopicTitle ?? "Current Topic",
      conceptTitle: conceptNode.title,
      conceptDesc: conceptNode.desc,
      diagnostic: diagnosticSummary,
      futureConceptTitles,
      maxConcepts: maxAdaptiveConcepts,
    });

    const insertionResult = await insertAdaptiveConceptsAfterCurrent(
      userId,
      conceptNode,
      adaptiveCandidates,
    );

    if (insertionResult.insertedConcepts.length) {
      await db.insert(nodeGenerations).values({
        id: uuid(),
        nodeId: conceptNode.id,
        trigger: "manual_regenerate",
        model: "claude-sonnet-4-6",
        prompt: `Concept agent adaptive insertion for: ${conceptNode.title}`,
        responseMeta: JSON.stringify({
          insertedCount: insertionResult.insertedConcepts.length,
          insertedTitles: insertionResult.insertedConcepts.map((node) => node.title),
          assessmentId: diagnosticSummary.assessmentId,
        }),
      });
    }

    res.json({
      agent: "concept",
      status: "ready",
      conceptNodeId: conceptNode.id,
      assessment: diagnosticState.assessment,
      gradedCount,
      diagnostic: diagnosticSummary,
      subconceptsGenerated: subconceptGraph.generated,
      subconcepts: subconceptGraph.subconcepts,
      subconceptEdges: subconceptGraph.edges,
      insertedConcepts: insertionResult.insertedConcepts,
      insertedConceptEdges: insertionResult.createdEdges,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
