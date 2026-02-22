import { db } from "../db";
import {
  nodes,
  nodeEdges,
  nodeGenerations,
  answers,
  userNodeProgress,
} from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { runAgentLoop, type AgentTool } from "./agent-loop";
import { gradeAnswers } from "./grade-answers";
import type { SSEWriter } from "../utils/sse";

type NodeRow = typeof nodes.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;
type QuestionRow = typeof import("../db/schema").questions.$inferSelect;

/**
 * Concept Refinement Agent — runs after student answers diagnostic questions.
 * Grades answers, analyzes gaps, and adapts the existing subconcept graph.
 */
export async function runConceptRefinementAgent(options: {
  userId: string;
  conceptNode: NodeRow;
  parentTopicTitle: string | null;
  assessmentId: string;
  assessmentQuestions: QuestionRow[];
  latestByQuestion: Map<string, AnswerRow>;
  sse: SSEWriter;
}): Promise<void> {
  const {
    userId,
    conceptNode,
    parentTopicTitle,
    assessmentId,
    assessmentQuestions,
    latestByQuestion,
    sse,
  } = options;

  // Pre-build data the tools will need
  const gradableQuestions = assessmentQuestions
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

  const tools: AgentTool[] = [
    {
      name: "grade_student_answers",
      description:
        "Grade the student's diagnostic answers. This launches a grading agent that evaluates each answer and returns scores and feedback.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        if (!gradableQuestions.length) {
          return JSON.stringify({ message: "No gradable answers found.", gradedCount: 0 });
        }

        const graded = await gradeAnswers(conceptNode.title, gradableQuestions);

        // Update answers in DB
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

        // Build summary
        const summary = buildDiagnosticSummary(
          assessmentId,
          assessmentQuestions,
          latestByQuestion,
        );

        return JSON.stringify({
          gradedCount: graded.length,
          overallScore: summary.overallScore,
          strengths: summary.strengths,
          gaps: summary.gaps,
          items: graded.map((g) => ({
            prompt: gradableQuestions.find((q) => q.questionId === g.questionId)?.prompt,
            isCorrect: g.isCorrect,
            score: g.score,
            feedback: g.feedback,
          })),
        });
      },
    },
    {
      name: "get_current_subconcepts",
      description:
        "View the existing subconcept graph for this concept — all subconcept nodes and their dependency edges.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        const subconcepts = await db
          .select()
          .from(nodes)
          .where(
            and(eq(nodes.parentId, conceptNode.id), eq(nodes.type, "subconcept")),
          );

        const subconceptIds = subconcepts.map((s) => s.id);
        const subconceptIdSet = new Set(subconceptIds);
        const titleById = new Map(subconcepts.map((s) => [s.id, s.title]));

        let edges: Array<{ source: string; target: string }> = [];
        if (subconceptIds.length) {
          const rawEdges = await db
            .select()
            .from(nodeEdges)
            .where(inArray(nodeEdges.sourceNodeId, subconceptIds));

          edges = rawEdges
            .filter((e) => subconceptIdSet.has(e.targetNodeId))
            .map((e) => ({
              source: titleById.get(e.sourceNodeId) ?? e.sourceNodeId,
              target: titleById.get(e.targetNodeId) ?? e.targetNodeId,
            }));
        }

        return JSON.stringify({
          count: subconcepts.length,
          subconcepts: subconcepts.map((s) => ({ title: s.title, desc: s.desc })),
          edges,
        });
      },
    },
    {
      name: "add_subconcept",
      description:
        "Add a new subconcept node to the graph (e.g., a remedial or bridge subconcept for a knowledge gap).",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Subconcept title" },
          desc: { type: "string", description: "One-sentence description" },
          depends_on: {
            type: "array",
            items: { type: "string" },
            description: "Titles of existing subconcepts this one depends on (can be empty)",
          },
        },
        required: ["title", "desc"],
      },
      async execute(input: { title: string; desc: string; depends_on?: string[] }) {
        const subconceptId = uuid();
        await db.insert(nodes).values({
          id: subconceptId,
          userId,
          type: "subconcept",
          branchId: conceptNode.branchId,
          parentId: conceptNode.id,
          title: input.title,
          desc: input.desc,
        });

        const created = await db
          .select()
          .from(nodes)
          .where(eq(nodes.id, subconceptId));
        const node = created[0];

        sse.send("node_created", { node });

        // Create dependency edges
        if (input.depends_on?.length) {
          const siblingSubconcepts = await db
            .select()
            .from(nodes)
            .where(
              and(eq(nodes.parentId, conceptNode.id), eq(nodes.type, "subconcept")),
            );
          const titleToId = new Map(siblingSubconcepts.map((s) => [s.title, s.id]));

          for (const depTitle of input.depends_on) {
            const depId = titleToId.get(depTitle);
            if (depId) {
              const existing = await db
                .select()
                .from(nodeEdges)
                .where(
                  and(
                    eq(nodeEdges.sourceNodeId, depId),
                    eq(nodeEdges.targetNodeId, subconceptId),
                  ),
                );
              if (!existing.length) {
                await db.insert(nodeEdges).values({
                  id: uuid(),
                  sourceNodeId: depId,
                  targetNodeId: subconceptId,
                });
              }
              sse.send("edge_created", {
                edge: { sourceNodeId: depId, targetNodeId: subconceptId },
              });
            }
          }
        }

        return JSON.stringify({ saved: true, nodeId: node.id, title: node.title });
      },
    },
    {
      name: "remove_subconcept",
      description:
        "Remove a subconcept the student already knows well. Also removes its edges.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Title of the subconcept to remove" },
        },
        required: ["title"],
      },
      async execute(input: { title: string }) {
        const subconcepts = await db
          .select()
          .from(nodes)
          .where(
            and(
              eq(nodes.parentId, conceptNode.id),
              eq(nodes.type, "subconcept"),
            ),
          );
        const target = subconcepts.find((s) => s.title === input.title);
        if (!target) {
          return JSON.stringify({ error: `Subconcept not found: "${input.title}"` });
        }

        // Remove edges involving this node
        const incomingEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.targetNodeId, target.id));
        const outgoingEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.sourceNodeId, target.id));

        for (const edge of [...incomingEdges, ...outgoingEdges]) {
          await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
          sse.send("edge_removed", {
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          });
        }

        // Reconnect: connect each incoming source to each outgoing target
        for (const incoming of incomingEdges) {
          for (const outgoing of outgoingEdges) {
            const existing = await db
              .select()
              .from(nodeEdges)
              .where(
                and(
                  eq(nodeEdges.sourceNodeId, incoming.sourceNodeId),
                  eq(nodeEdges.targetNodeId, outgoing.targetNodeId),
                ),
              );
            if (!existing.length) {
              await db.insert(nodeEdges).values({
                id: uuid(),
                sourceNodeId: incoming.sourceNodeId,
                targetNodeId: outgoing.targetNodeId,
              });
              sse.send("edge_created", {
                edge: {
                  sourceNodeId: incoming.sourceNodeId,
                  targetNodeId: outgoing.targetNodeId,
                },
              });
            }
          }
        }

        await db.delete(nodes).where(eq(nodes.id, target.id));
        sse.send("node_removed", { nodeId: target.id });

        return JSON.stringify({ removed: true, title: input.title });
      },
    },
    {
      name: "get_future_concepts",
      description:
        "Check what concepts come after this one in the learning path. Useful for deciding if an adaptive concept is needed.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        if (!conceptNode.parentId) return JSON.stringify({ futureConcepts: [] });

        const siblingConcepts = await db
          .select()
          .from(nodes)
          .where(
            and(
              eq(nodes.parentId, conceptNode.parentId),
              eq(nodes.type, "concept"),
            ),
          );

        if (siblingConcepts.length <= 1) return JSON.stringify({ futureConcepts: [] });

        const conceptIds = siblingConcepts.map((n) => n.id);
        const conceptIdSet = new Set(conceptIds);
        const titleById = new Map(siblingConcepts.map((n) => [n.id, n.title]));

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

        const queue = [conceptNode.id];
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

        const futureTitles = futureIds
          .map((id) => titleById.get(id))
          .filter((t): t is string => !!t);

        return JSON.stringify({ futureConcepts: futureTitles });
      },
    },
    {
      name: "add_prerequisite_concept",
      description:
        "Insert a new concept BEFORE the current one in the learning path. Use this when the student is missing foundational knowledge that should have been covered earlier.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "New concept title" },
          desc: { type: "string", description: "One-sentence description" },
        },
        required: ["title", "desc"],
      },
      async execute(input: { title: string; desc: string }) {
        if (!conceptNode.parentId) {
          return JSON.stringify({ error: "Cannot add prerequisite — no parent topic" });
        }

        const conceptId = uuid();
        await db.insert(nodes).values({
          id: conceptId,
          userId,
          type: "concept",
          branchId: conceptNode.branchId,
          parentId: conceptNode.parentId,
          title: input.title,
          desc: input.desc,
        });

        const created = await db
          .select()
          .from(nodes)
          .where(eq(nodes.id, conceptId));
        const newNode = created[0];

        // Rewire: find edges pointing TO current concept, insert new concept before it
        const incomingEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.targetNodeId, conceptNode.id));

        for (const edge of incomingEdges) {
          // Delete old edge
          await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
          sse.send("edge_removed", {
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          });

          // Create edge: old source → new concept
          await db.insert(nodeEdges).values({
            id: uuid(),
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: conceptId,
          });
          sse.send("edge_created", {
            edge: { sourceNodeId: edge.sourceNodeId, targetNodeId: conceptId },
          });
        }

        // Create edge: new concept → current concept
        await db.insert(nodeEdges).values({
          id: uuid(),
          sourceNodeId: conceptId,
          targetNodeId: conceptNode.id,
        });

        sse.send("node_created", { node: newNode });
        sse.send("edge_created", {
          edge: { sourceNodeId: conceptId, targetNodeId: conceptNode.id },
        });

        return JSON.stringify({ saved: true, nodeId: newNode.id, title: newNode.title });
      },
    },
    {
      name: "validate_graph",
      description:
        "Validate the subconcept graph for structural issues — orphan nodes, unreachable nodes, broken edges. Call this AFTER making modifications to verify the graph is clean.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        const subconcepts = await db
          .select()
          .from(nodes)
          .where(
            and(eq(nodes.parentId, conceptNode.id), eq(nodes.type, "subconcept")),
          );

        const subconceptIds = subconcepts.map((s) => s.id);
        const subconceptIdSet = new Set(subconceptIds);
        const titleById = new Map(subconcepts.map((s) => [s.id, s.title]));

        if (!subconceptIds.length) {
          return JSON.stringify({ valid: true, issues: [], message: "No subconcepts to validate." });
        }

        const allEdges = await db
          .select()
          .from(nodeEdges)
          .where(inArray(nodeEdges.sourceNodeId, subconceptIds));

        const internalEdges = allEdges.filter((e) => subconceptIdSet.has(e.targetNodeId));

        // Also get incoming edges
        const incomingEdges = await db
          .select()
          .from(nodeEdges)
          .where(inArray(nodeEdges.targetNodeId, subconceptIds));

        const internalIncoming = incomingEdges.filter((e) => subconceptIdSet.has(e.sourceNodeId));

        const issues: string[] = [];

        // Check for orphan nodes (no edges at all)
        const nodesWithEdges = new Set<string>();
        for (const e of [...internalEdges, ...internalIncoming]) {
          nodesWithEdges.add(e.sourceNodeId);
          nodesWithEdges.add(e.targetNodeId);
        }
        const orphanNodes = subconcepts
          .filter((s) => !nodesWithEdges.has(s.id))
          .map((s) => s.title);

        if (orphanNodes.length && subconcepts.length > 1) {
          issues.push(`Orphan nodes (no connections): ${orphanNodes.join(", ")}`);
        }

        // Check for broken edges (target doesn't exist in subconcepts)
        const brokenEdges = allEdges
          .filter((e) => !subconceptIdSet.has(e.targetNodeId))
          .map((e) => `${titleById.get(e.sourceNodeId)} -> [missing node]`);

        if (brokenEdges.length) {
          issues.push(`Broken edges: ${brokenEdges.join(", ")}`);
        }

        // BFS reachability from root nodes (nodes with no incoming internal edges)
        const hasIncoming = new Set(internalIncoming.map((e) => e.targetNodeId));
        const roots = subconceptIds.filter((id) => !hasIncoming.has(id));

        const adjacency = new Map<string, string[]>();
        for (const e of internalEdges) {
          const out = adjacency.get(e.sourceNodeId) || [];
          out.push(e.targetNodeId);
          adjacency.set(e.sourceNodeId, out);
        }

        const reachable = new Set<string>(roots);
        const queue = [...roots];
        while (queue.length) {
          const current = queue.shift()!;
          for (const next of adjacency.get(current) || []) {
            if (!reachable.has(next)) {
              reachable.add(next);
              queue.push(next);
            }
          }
        }

        const unreachableNodes = subconcepts
          .filter((s) => !reachable.has(s.id))
          .map((s) => s.title);

        if (unreachableNodes.length) {
          issues.push(`Unreachable nodes (not connected to any root): ${unreachableNodes.join(", ")}`);
        }

        return JSON.stringify({
          valid: issues.length === 0,
          issues,
          orphanNodes,
          unreachableNodes,
          totalNodes: subconcepts.length,
          totalEdges: internalEdges.length,
          rootNodes: roots.map((id) => titleById.get(id)),
        });
      },
    },
    {
      name: "add_followup_concept",
      description:
        "Insert a new concept AFTER the current one in the learning path. Use this when the student needs reinforcement or enrichment before moving to the next concept.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "New concept title" },
          desc: { type: "string", description: "One-sentence description" },
        },
        required: ["title", "desc"],
      },
      async execute(input: { title: string; desc: string }) {
        if (!conceptNode.parentId) {
          return JSON.stringify({ error: "Cannot add follow-up — no parent topic" });
        }

        const conceptId = uuid();
        await db.insert(nodes).values({
          id: conceptId,
          userId,
          type: "concept",
          branchId: conceptNode.branchId,
          parentId: conceptNode.parentId,
          title: input.title,
          desc: input.desc,
        });

        const created = await db
          .select()
          .from(nodes)
          .where(eq(nodes.id, conceptId));
        const newNode = created[0];

        // Rewire: find edges going FROM current concept to sibling concepts, insert new concept after
        const outgoingEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.sourceNodeId, conceptNode.id));

        // Filter to only sibling concept edges
        const siblingConcepts = await db
          .select()
          .from(nodes)
          .where(
            and(
              eq(nodes.parentId, conceptNode.parentId),
              eq(nodes.type, "concept"),
            ),
          );
        const siblingIdSet = new Set(siblingConcepts.map((s) => s.id));

        const siblingOutgoing = outgoingEdges.filter((e) => siblingIdSet.has(e.targetNodeId));

        for (const edge of siblingOutgoing) {
          // Delete old edge: current → old_target
          await db.delete(nodeEdges).where(eq(nodeEdges.id, edge.id));
          sse.send("edge_removed", {
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          });

          // Create edge: new_concept → old_target
          await db.insert(nodeEdges).values({
            id: uuid(),
            sourceNodeId: conceptId,
            targetNodeId: edge.targetNodeId,
          });
          sse.send("edge_created", {
            edge: { sourceNodeId: conceptId, targetNodeId: edge.targetNodeId },
          });
        }

        // Create edge: current → new_concept
        await db.insert(nodeEdges).values({
          id: uuid(),
          sourceNodeId: conceptNode.id,
          targetNodeId: conceptId,
        });

        sse.send("node_created", { node: newNode });
        sse.send("edge_created", {
          edge: { sourceNodeId: conceptNode.id, targetNodeId: conceptId },
        });

        return JSON.stringify({ saved: true, nodeId: newNode.id, title: newNode.title });
      },
    },
    {
      name: "check_student_history",
      description:
        "Check the student's cross-concept performance — completed concepts, mastery scores, attempt counts. Use this to determine if gaps are concept-specific or systemic.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        const allProgress = await db
          .select()
          .from(userNodeProgress)
          .where(eq(userNodeProgress.userId, userId));

        if (!allProgress.length) {
          return JSON.stringify({ completedConcepts: [], overallLevel: "new_student", averageMastery: 0 });
        }

        // Get node titles for progress entries
        const progressNodeIds = allProgress.map((p) => p.nodeId);
        const progressNodes = await db
          .select()
          .from(nodes)
          .where(inArray(nodes.id, progressNodeIds));

        const nodeTitleMap = new Map(progressNodes.map((n) => [n.id, n.title]));

        const completedConcepts = allProgress
          .filter((p) => p.completedAt)
          .map((p) => ({
            title: nodeTitleMap.get(p.nodeId) ?? p.nodeId,
            masteryScore: p.masteryScore,
          }));

        const scores = allProgress.map((p) => p.masteryScore);
        const averageMastery = scores.length
          ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3))
          : 0;

        let overallLevel: string;
        if (averageMastery >= 0.8) overallLevel = "advanced";
        else if (averageMastery >= 0.5) overallLevel = "intermediate";
        else if (completedConcepts.length > 0) overallLevel = "beginner";
        else overallLevel = "new_student";

        return JSON.stringify({
          completedConcepts,
          overallLevel,
          averageMastery,
          totalTrackedNodes: allProgress.length,
          totalCompleted: completedConcepts.length,
        });
      },
    },
  ];

  const systemPrompt = `You are an adaptive learning agent for the platform Sprout. A student just completed a diagnostic assessment on the concept "${conceptNode.title}"${parentTopicTitle ? ` (part of topic "${parentTopicTitle}")` : ""}.

Subconcepts already exist for this concept from initial generation. Your job is to PERSONALIZE the learning path based on the student's actual performance.

PROCESS (Observe-Reason-Act-Verify):
1. GRADE: Call grade_student_answers to grade the diagnostic and see results.
2. OBSERVE: Call get_current_subconcepts + check_student_history to see the full picture.
3. REASON: What do the results reveal? Gaps? Misconceptions? Mastery? Are issues concept-specific or systemic?
4. ACT: Modify the learning path:
   - ADD bridge subconcepts for knowledge gaps (use add_subconcept)
   - REMOVE subconcepts the student has already mastered (use remove_subconcept)
   - Insert prerequisite concepts BEFORE (add_prerequisite_concept) for foundational gaps
   - Insert follow-up concepts AFTER (add_followup_concept) for reinforcement/enrichment
5. VERIFY: Call validate_graph. If issues found, FIX them (add missing edges, remove orphans).
6. VERIFY AGAIN: Call validate_graph to confirm the graph is clean after fixes.

GUIDELINES:
- Don't over-modify. 1-3 targeted changes are better than restructuring everything.
- Bridge subconcepts should explicitly address misconceptions or gaps shown in the diagnostic.
- Only remove subconcepts if the student clearly demonstrated mastery (high scores on related questions).
- Only add a prerequisite concept if there are fundamental gaps that can't be addressed with subconcept adjustments.
- Always verify the graph after modifications — never leave it in a broken state.`;

  const initialMessage = `The student has completed the diagnostic for "${conceptNode.title}". Analyze their performance and adapt the learning path.`;

  sse.send("agent_start", { agent: "concept_refinement" });

  const result = await runAgentLoop({
    model: "claude-sonnet-4-6",
    systemPrompt,
    tools,
    initialMessage,
    maxIterations: 15,
    callbacks: {
      onThinking(text) {
        sse.send("agent_reasoning", { agent: "concept_refinement", text });
      },
      onToolCall(name, input) {
        sse.send("tool_call", { tool: name, input });
      },
      onToolResult(name, resultStr) {
        sse.send("tool_result", {
          tool: name,
          summary: resultStr.length > 200 ? resultStr.slice(0, 200) + "..." : resultStr,
        });
      },
    },
  });

  // Log generation
  await db.insert(nodeGenerations).values({
    id: uuid(),
    nodeId: conceptNode.id,
    trigger: "manual_regenerate",
    model: "claude-sonnet-4-6",
    prompt: `Concept refinement for: ${conceptNode.title}`,
    responseMeta: JSON.stringify({
      mode: "concept_refinement_agent",
      assessmentId,
      toolCalls: result.toolCalls.map((tc) => tc.name),
    }),
  });
}

// ── Helpers ────────────────────────────────────────────────

function extractStudentAnswer(answer?: AnswerRow): string | null {
  const raw = answer?.answerText ?? answer?.selectedOption ?? null;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

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

function buildDiagnosticSummary(
  assessmentId: string,
  assessmentQuestions: QuestionRow[],
  latestByQuestion: Map<string, AnswerRow>,
) {
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
