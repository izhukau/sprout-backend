import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import {
  nodes,
  nodeEdges,
  nodeGenerations,
  topicDocuments,
} from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { runAgentLoop, type AgentTool } from "./agent-loop";
import { parseJsonResponse } from "./parse-json";
import type { SSEWriter } from "../utils/sse";

const anthropic = new Anthropic();

type NodeRow = typeof nodes.$inferSelect;

export interface SavedConcept {
  node: NodeRow;
  documentContext: string | null;
}

/**
 * Runs the Topic Agent as a real agentic loop with tools.
 * The agent decides what concepts to create, saves them via tools,
 * and optionally extracts document context for downstream agents.
 */
export async function runTopicAgent(options: {
  userId: string;
  topicNode: NodeRow;
  sse: SSEWriter;
  small?: boolean;
}): Promise<{ concepts: SavedConcept[]; rationale: string }> {
  const { userId, topicNode, sse, small } = options;

  // Check for existing concepts first
  const existingConcepts = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.parentId, topicNode.id), eq(nodes.type, "concept")));

  if (existingConcepts.length) {
    for (const concept of existingConcepts) {
      sse.send("node_created", { node: concept });
    }

    const conceptIds = existingConcepts.map((c) => c.id);
    const conceptIdSet = new Set(conceptIds);
    const existingEdges = await db
      .select()
      .from(nodeEdges)
      .where(inArray(nodeEdges.sourceNodeId, conceptIds));

    for (const edge of existingEdges) {
      if (conceptIdSet.has(edge.targetNodeId)) {
        sse.send("edge_created", {
          edge: {
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          },
        });
      }
    }

    return {
      concepts: existingConcepts.map((n) => ({
        node: n,
        documentContext: null,
      })),
      rationale: "Existing concepts loaded.",
    };
  }

  // Fetch uploaded documents
  const topicDocs = await db
    .select()
    .from(topicDocuments)
    .where(
      and(
        eq(topicDocuments.nodeId, topicNode.id),
        eq(topicDocuments.extractionStatus, "completed"),
      ),
    );

  const documentContents = prepareDocumentContext(topicDocs);

  // State accumulated by tools
  const savedConcepts: SavedConcept[] = [];
  let conceptContextMap: Record<string, string> = {};

  // Define tools — only action tools, no "generate" wrappers
  const tools: AgentTool[] = [
    {
      name: "extract_all_concept_contexts",
      description:
        "Extract relevant document sections for ALL concepts in one batch. Pass the concept titles and descriptions you've decided on. Returns a map of relevant excerpts per concept. Only call this if documents were uploaded for this topic.",
      input_schema: {
        type: "object" as const,
        properties: {
          concepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                desc: { type: "string" },
              },
              required: ["title", "desc"],
            },
            description: "The list of concepts to extract context for",
          },
        },
        required: ["concepts"],
      },
      async execute(input: {
        concepts: Array<{ title: string; desc: string }>;
      }) {
        if (!documentContents) {
          return JSON.stringify({
            message: "No documents uploaded, skipping extraction.",
          });
        }

        const conceptList = input.concepts
          .map((c, i) => `${i + 1}. "${c.title}" — ${c.desc}`)
          .join("\n");

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `You are extracting relevant document sections for educational concepts.

Given these concepts:
${conceptList}

And this reference document:
--- DOCUMENT ---
${documentContents}
--- END DOCUMENT ---

For EACH concept, extract the most relevant section(s) from the document. Return a JSON object where keys are concept titles and values are the relevant excerpts (200-500 words each). If a concept has no relevant document content, use null.

Return ONLY valid JSON, no other text.`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          return JSON.stringify({ error: "No response from extraction" });
        }

        try {
          conceptContextMap = parseJsonResponse<Record<string, string>>(
            textBlock.text,
          );
        } catch {
          conceptContextMap = {};
        }

        const extractedCount =
          Object.values(conceptContextMap).filter(Boolean).length;
        return JSON.stringify({
          extractedCount,
          totalConcepts: input.concepts.length,
        });
      },
    },
    {
      name: "save_concept",
      description:
        "Save a concept to the database and notify the frontend in real-time. Call this once per concept, in learning order.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Concept title" },
          desc: {
            type: "string",
            description: "One-sentence description of what this concept covers",
          },
        },
        required: ["title", "desc"],
      },
      async execute(input: { title: string; desc: string }) {
        const conceptId = uuid();
        await db.insert(nodes).values({
          id: conceptId,
          userId,
          type: "concept",
          branchId: topicNode.branchId,
          parentId: topicNode.id,
          title: input.title,
          desc: input.desc,
        });

        const created = await db
          .select()
          .from(nodes)
          .where(eq(nodes.id, conceptId));
        const node = created[0];

        sse.send("node_created", { node });

        const docContext = conceptContextMap[input.title] ?? null;
        savedConcepts.push({ node, documentContext: docContext });

        return JSON.stringify({
          saved: true,
          nodeId: node.id,
          title: node.title,
          position: savedConcepts.length,
        });
      },
    },
    {
      name: "save_concept_edge",
      description:
        "Create a dependency edge between two saved concepts (source → target). Call after saving both concepts.",
      input_schema: {
        type: "object" as const,
        properties: {
          source_title: {
            type: "string",
            description: "Title of the prerequisite concept",
          },
          target_title: {
            type: "string",
            description: "Title of the dependent concept",
          },
        },
        required: ["source_title", "target_title"],
      },
      async execute(input: { source_title: string; target_title: string }) {
        const sourceNode = savedConcepts.find(
          (c) => c.node.title === input.source_title,
        );
        const targetNode = savedConcepts.find(
          (c) => c.node.title === input.target_title,
        );

        if (!sourceNode || !targetNode) {
          return JSON.stringify({
            error: `Could not find saved nodes: source="${input.source_title}" target="${input.target_title}"`,
          });
        }

        const existing = await db
          .select()
          .from(nodeEdges)
          .where(
            and(
              eq(nodeEdges.sourceNodeId, sourceNode.node.id),
              eq(nodeEdges.targetNodeId, targetNode.node.id),
            ),
          );

        if (!existing.length) {
          await db.insert(nodeEdges).values({
            id: uuid(),
            sourceNodeId: sourceNode.node.id,
            targetNodeId: targetNode.node.id,
          });
        }

        sse.send("edge_created", {
          edge: {
            sourceNodeId: sourceNode.node.id,
            targetNodeId: targetNode.node.id,
          },
        });

        return JSON.stringify({ saved: true });
      },
    },
  ];

  // Build system prompt
  const docInstruction = documentContents
    ? `The user has uploaded reference documents for this topic. You MUST use these documents as the PRIMARY source:
1. FOLLOW the document's structure and chapter ordering as the basis for concept ordering.
2. COVER the document's content — each concept should correspond to major sections or chapters.
3. PRESERVE the document's pedagogical sequence.
4. USE the document's terminology.

After deciding on your concepts, use extract_all_concept_contexts to extract relevant document sections. This context will be passed to downstream subconcept agents.

--- REFERENCE DOCUMENTS ---
${documentContents}
--- END REFERENCE DOCUMENTS ---`
    : "No documents were uploaded for this topic. Use your expertise to design the learning path.";

  const systemPrompt = `You are a curriculum design agent for the adaptive learning platform Sprout. You autonomously design learning paths.

YOUR TASK: Create an optimal learning path of ${small ? "1-2" : "6-10"} concepts for the given topic, ordered from foundational to advanced.

PROCESS:
1. Think about what concepts a student needs to learn for this topic and in what order.
2. Verify internally that the ordering is logical, there are no major gaps, and prerequisites flow correctly.
3. ${documentContents ? "Call extract_all_concept_contexts to extract relevant document sections for each concept." : "Skip document extraction (no documents uploaded)."}
4. Save each concept using save_concept (call it once per concept, in learning order).
5. Create edges between consecutive concepts using save_concept_edge (concept1 → concept2, concept2 → concept3, etc.).

Each concept should:
- Have a clear, short title
- Have a one-sentence description of what it covers
- Build on the previous concept in the sequence

${docInstruction}

The concepts you create will be used by downstream agents to generate subconcepts and diagnostic questions for each concept.`;

  const initialMessage = `Design a learning path for the topic: "${topicNode.title}"${topicNode.desc ? `\nDescription: ${topicNode.desc}` : ""}`;

  sse.send("agent_start", { agent: "topic" });

  const result = await runAgentLoop({
    model: small ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6",
    systemPrompt,
    tools,
    initialMessage,
    maxIterations: small ? 10 : 15,
    callbacks: {
      onThinking(text) {
        sse.send("agent_reasoning", { agent: "topic", text });
      },
      onToolCall(name, input) {
        sse.send("tool_call", { tool: name, input });
      },
      onToolResult(name, resultStr) {
        sse.send("tool_result", {
          tool: name,
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
    nodeId: topicNode.id,
    trigger: "on_first_enter",
    model: "claude-sonnet-4-6",
    prompt: `Topic agent bootstrap for: ${topicNode.title}`,
    responseMeta: JSON.stringify({
      count: savedConcepts.length,
      mode: "topic_agent",
      toolCalls: result.toolCalls.map((tc) => tc.name),
    }),
  });

  return {
    concepts: savedConcepts,
    rationale:
      result.finalText || "Learning path generated via agentic topic agent.",
  };
}

// ── Helpers ────────────────────────────────────────────────

const MAX_DOCUMENT_CHARS = 80_000;

function prepareDocumentContext(
  docs: Array<{ originalFilename: string; extractedText: string | null }>,
): string | null {
  const parts: string[] = [];

  for (const doc of docs) {
    if (!doc.extractedText) continue;
    const header = `--- Document: ${doc.originalFilename} ---`;
    parts.push(header + "\n" + doc.extractedText);
  }

  if (!parts.length) return null;

  let combined = parts.join("\n\n");
  if (combined.length > MAX_DOCUMENT_CHARS) {
    combined =
      combined.slice(0, MAX_DOCUMENT_CHARS) +
      "\n\n[... document content truncated at 80,000 characters ...]";
  }

  return combined;
}
