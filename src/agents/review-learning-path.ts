import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";

const anthropic = new Anthropic();

export interface GraphNodeContext {
  title: string;
  desc: string | null;
}

export interface GraphEdgeContext {
  source: string;
  target: string;
}

export interface ConceptReviewAddition {
  title: string;
  desc: string;
  insert_after: string;
  reason: string;
}

export interface SubconceptReviewAddition {
  title: string;
  desc: string;
  depends_on: string[];
  unlocks: string[];
  reason: string;
}

export interface LearningPathReviewDecision {
  should_add: boolean;
  notes?: string | null;
  concept_additions?: ConceptReviewAddition[];
  subconcept_additions?: SubconceptReviewAddition[];
}

export interface LearningPathReviewInput {
  level: "concept" | "subconcept";
  topicTitle: string;
  currentNodeTitle: string;
  currentNodeDesc?: string | null;
  overview: string;
  siblingNodes: GraphNodeContext[];
  siblingEdges: GraphEdgeContext[];
  maxAdditions?: number;
}

/**
 * Post-completion review agent:
 * decides whether to enrich the learning path and where to insert new nodes.
 */
export async function reviewLearningPath(
  input: LearningPathReviewInput,
): Promise<LearningPathReviewDecision> {
  const maxAdditions = Math.max(0, Math.min(4, input.maxAdditions ?? 2));
  const levelSpecificRules =
    input.level === "concept"
      ? `You are reviewing the concept-level path. If proposing new concepts, each item must include:
- "title"
- "desc"
- "insert_after": exact title of an existing concept after which this new concept should be inserted
- "reason"`
      : `You are reviewing the subconcept-level graph. If proposing new subconcepts, each item must include:
- "title"
- "desc"
- "depends_on": exact titles of prerequisite subconcepts (can be empty)
- "unlocks": exact titles of existing subconcepts that should depend on this new one (can be empty)
- "reason"`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an adaptive curriculum review agent.

Task: review the current learning graph and decide if we should add 0-${maxAdditions} new nodes.
This is NOT only about mistakes. You may add nodes for:
- missing prerequisites
- reinforcement of fragile understanding
- enrichment/extension opportunities
- better conceptual transitions

Level: "${input.level}"
Topic: "${input.topicTitle}"
Current node: "${input.currentNodeTitle}"
Current node description: "${input.currentNodeDesc ?? ""}"

Overall learner overview:
${input.overview}

Existing sibling nodes:
${JSON.stringify(input.siblingNodes, null, 2)}

Existing sibling edges:
${JSON.stringify(input.siblingEdges, null, 2)}

Rules:
- Keep additions minimal and high-impact.
- Never duplicate existing titles.
- Use exact existing titles when referencing insertion anchors/dependencies.
- If no useful addition is needed, return should_add=false.

${levelSpecificRules}

Return ONLY a JSON object, no other text. Format:
{
  "should_add": boolean,
  "notes": "short reason",
  "concept_additions": [...],      // only for level=concept
  "subconcept_additions": [...]    // only for level=subconcept
}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const parsed = parseJsonResponse<LearningPathReviewDecision>(textBlock.text);
  const decision: LearningPathReviewDecision = {
    should_add: !!parsed?.should_add,
    notes: parsed?.notes ?? null,
    concept_additions: Array.isArray(parsed?.concept_additions)
      ? parsed.concept_additions.slice(0, maxAdditions)
      : [],
    subconcept_additions: Array.isArray(parsed?.subconcept_additions)
      ? parsed.subconcept_additions.slice(0, maxAdditions)
      : [],
  };

  return decision;
}
