import { db } from "../db";
import {
  nodes,
  nodeEdges,
  nodeGenerations,
  assessments,
  questions,
  userNodeProgress,
} from "../db/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { runAgentLoop, type AgentTool } from "./agent-loop";
import type { SSEWriter } from "../utils/sse";

type NodeRow = typeof nodes.$inferSelect;

/**
 * Subconcept Bootstrap Agent — runs for each concept after the Topic Agent finishes.
 * The agent autonomously decides what subconcepts and diagnostic questions to create.
 * No wrapper functions — the agent thinks for itself and uses action tools to persist.
 */
export async function runSubconceptBootstrapAgent(options: {
  userId: string;
  conceptNode: NodeRow;
  topicTitle: string;
  documentContext: string | null;
  sse: SSEWriter;
  small?: boolean;
  generateQuestions?: boolean;
}): Promise<void> {
  const {
    userId,
    conceptNode,
    topicTitle,
    documentContext,
    sse,
    small,
    generateQuestions = true,
  } = options;

  // Check if subconcepts already exist
  const existingSubconcepts = await db
    .select()
    .from(nodes)
    .where(
      and(eq(nodes.parentId, conceptNode.id), eq(nodes.type, "subconcept")),
    );

  if (existingSubconcepts.length) {
    for (const sc of existingSubconcepts) {
      sse.send("node_created", { node: sc });
    }
    return;
  }

  // State accumulated by tools
  const savedSubconcepts: NodeRow[] = [];
  const titleToId: Record<string, string> = {};
  let assessmentId: string | null = null;

  const tools: AgentTool[] = [];

  if (generateQuestions) {
    tools.push({
      name: "save_diagnostic_question",
      description:
        "Save a diagnostic question for this concept. Questions will be shown to the student before they start learning to assess their existing knowledge.",
      input_schema: {
        type: "object" as const,
        properties: {
          prompt: { type: "string", description: "The question text" },
          format: {
            type: "string",
            enum: ["mcq", "open_ended"],
            description:
              "Question format: 'mcq' for multiple choice (must provide 4 options), 'open_ended' for short answer",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description:
              "Exactly 4 answer options (only for mcq format, omit for open_ended)",
          },
          correct_answer: {
            type: "string",
            description:
              "The correct answer. For mcq: the exact text of the correct option. For open_ended: the expected answer.",
          },
          difficulty: {
            type: "integer",
            description:
              "Difficulty level 1-5 (1=easy basics, 3=application, 5=deep analysis)",
          },
        },
        required: ["prompt", "format", "correct_answer", "difficulty"],
      },
      async execute(input: {
        prompt: string;
        format: "mcq" | "open_ended";
        options?: string[];
        correct_answer: string;
        difficulty: number;
      }) {
        // Create assessment on first question
        if (!assessmentId) {
          const existing = await db
            .select()
            .from(assessments)
            .where(
              and(
                eq(assessments.userId, userId),
                eq(assessments.targetNodeId, conceptNode.id),
                eq(assessments.type, "diagnostic"),
              ),
            );

          if (existing.length) {
            assessmentId = existing[0].id;
          } else {
            assessmentId = uuid();
            await db.insert(assessments).values({
              id: assessmentId,
              userId,
              targetNodeId: conceptNode.id,
              type: "diagnostic",
              title: `Diagnostic for ${conceptNode.title}`,
            });
          }
        }

        await db.insert(questions).values({
          id: uuid(),
          assessmentId,
          nodeId: conceptNode.id,
          format: input.format,
          prompt: input.prompt,
          options: input.options ? JSON.stringify(input.options) : null,
          correctAnswer: input.correct_answer,
          difficulty: input.difficulty,
        });

        return JSON.stringify({
          saved: true,
          format: input.format,
          difficulty: input.difficulty,
        });
      },
    });
  }

  tools.push(
    {
      name: "save_subconcept",
      description:
        "Save a subconcept node to the database and notify the frontend in real-time.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Subconcept title" },
          desc: { type: "string", description: "One-sentence description" },
        },
        required: ["title", "desc"],
      },
      async execute(input: { title: string; desc: string }) {
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

        titleToId[input.title] = node.id;
        savedSubconcepts.push(node);

        sse.send("node_created", { node });

        return JSON.stringify({
          saved: true,
          nodeId: node.id,
          title: node.title,
        });
      },
    },
    {
      name: "save_subconcept_edge",
      description:
        "Create a dependency edge between two subconcepts (prerequisite → dependent). The source subconcept must be learned before the target.",
      input_schema: {
        type: "object" as const,
        properties: {
          source_title: {
            type: "string",
            description: "Title of the prerequisite subconcept",
          },
          target_title: {
            type: "string",
            description:
              "Title of the dependent subconcept (learns after source)",
          },
        },
        required: ["source_title", "target_title"],
      },
      async execute(input: { source_title: string; target_title: string }) {
        const sourceId = titleToId[input.source_title];
        const targetId = titleToId[input.target_title];

        if (!sourceId || !targetId) {
          return JSON.stringify({
            error: `Could not find saved subconcepts: source="${input.source_title}" target="${input.target_title}"`,
          });
        }

        const existing = await db
          .select()
          .from(nodeEdges)
          .where(
            and(
              eq(nodeEdges.sourceNodeId, sourceId),
              eq(nodeEdges.targetNodeId, targetId),
            ),
          );

        if (!existing.length) {
          await db.insert(nodeEdges).values({
            id: uuid(),
            sourceNodeId: sourceId,
            targetNodeId: targetId,
          });
        }

        sse.send("edge_created", {
          edge: { sourceNodeId: sourceId, targetNodeId: targetId },
        });

        return JSON.stringify({ saved: true });
      },
    },
  );

  const docSection = documentContext
    ? `\nUse this reference material to ground your work in the actual course content:\n--- REFERENCE MATERIAL ---\n${documentContext}\n--- END REFERENCE MATERIAL ---`
    : "";

  const taskSection = generateQuestions
    ? `1. CREATE DIAGNOSTIC QUESTIONS (${small ? "2-3" : "5-10"} questions)
   Use save_diagnostic_question for each question. These assess what the student already knows.
   Mix formats and difficulties:
   - ${small ? "1" : "2-3"} EASY (difficulty 1-2): basic definitions and recognition
   - ${small ? "1" : "3-4"} MEDIUM (difficulty 3): application and understanding
   - ${small ? "1" : "1-3"} HARD (difficulty 4-5): deeper analysis and connections
   Mix "mcq" (4 options, one correct) and "open_ended" formats.

2. CREATE SUBCONCEPTS (${small ? "2-3" : "8-12"} subconcepts)
   Use save_subconcept for each. These are the detailed learning units within this concept.
   Think about what a student needs to learn and in what order.

3. CREATE DEPENDENCY EDGES`
    : `1. CREATE SUBCONCEPTS (${small ? "2-3" : "8-12"} subconcepts)
   Use save_subconcept for each. These are the detailed learning units within this concept.
   Think about what a student needs to learn and in what order.

2. CREATE DEPENDENCY EDGES`;

  const systemPrompt = `You are a learning path builder for the adaptive learning platform Sprout. You autonomously set up the learning structure for a single concept.

CONCEPT: "${conceptNode.title}"${conceptNode.desc ? ` — ${conceptNode.desc}` : ""}
TOPIC: "${topicTitle}"
${docSection}

YOUR TASKS:

${taskSection}
   Use save_subconcept_edge for each dependency. Subconcepts can depend on each other,
   forming a directed acyclic graph (DAG) — not just a linear sequence.
   Some subconcepts are independent entry points (no dependencies).
   Others require prior subconcepts to be understood first.

Save all questions first, then all subconcepts, then all edges.`;

  const initialMessage = `Build the learning structure for concept: "${conceptNode.title}" (part of topic: "${topicTitle}")`;

  sse.send("agent_start", {
    agent: `subconcept_bootstrap:${conceptNode.title}`,
  });

  const result = await runAgentLoop({
    model: small ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6",
    systemPrompt,
    tools,
    initialMessage,
    maxIterations: small ? 10 : 15,
    callbacks: {
      onThinking(text) {
        sse.send("agent_reasoning", {
          agent: `subconcept_bootstrap:${conceptNode.title}`,
          text,
        });
      },
      onToolCall(name, input) {
        sse.send("tool_call", {
          tool: name,
          agent: `subconcept_bootstrap:${conceptNode.title}`,
          input,
        });
      },
      onToolResult(name, resultStr) {
        sse.send("tool_result", {
          tool: name,
          agent: `subconcept_bootstrap:${conceptNode.title}`,
          summary:
            resultStr.length > 200
              ? resultStr.slice(0, 200) + "..."
              : resultStr,
        });
      },
    },
  });

  // Log generation
  await db.insert(nodeGenerations).values({
    id: uuid(),
    nodeId: conceptNode.id,
    trigger: "on_first_enter",
    model: "claude-sonnet-4-6",
    prompt: `Subconcept bootstrap for: ${conceptNode.title}`,
    responseMeta: JSON.stringify({
      count: savedSubconcepts.length,
      mode: "subconcept_bootstrap_agent",
      toolCalls: result.toolCalls.map((tc) => tc.name),
    }),
  });

  // Mark progress — only flag hasGeneratedSubnodes if we actually saved some
  const hasSubnodes = savedSubconcepts.length > 0;
  const now = new Date().toISOString();
  const progress = await db
    .select()
    .from(userNodeProgress)
    .where(
      and(
        eq(userNodeProgress.userId, userId),
        eq(userNodeProgress.nodeId, conceptNode.id),
      ),
    );

  if (progress.length) {
    await db
      .update(userNodeProgress)
      .set({ hasGeneratedSubnodes: hasSubnodes, updatedAt: now })
      .where(eq(userNodeProgress.id, progress[0].id));
  } else {
    await db.insert(userNodeProgress).values({
      id: uuid(),
      userId,
      nodeId: conceptNode.id,
      firstEnteredAt: now,
      lastEnteredAt: now,
      attemptsCount: 0,
      hasGeneratedSubnodes: hasSubnodes,
    });
  }
}
