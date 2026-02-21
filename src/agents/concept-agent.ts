import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";
import { type SubconceptGenerationDiagnostic } from "./generate-subconcepts";

const anthropic = new Anthropic();

export interface AdaptiveConceptCandidate {
  title: string;
  desc: string;
  reason: string;
}

export interface ConceptAgentInput {
  topicTitle: string;
  conceptTitle: string;
  conceptDesc?: string | null;
  diagnostic: SubconceptGenerationDiagnostic;
  futureConceptTitles: string[];
  maxConcepts?: number;
}

/**
 * Concept agent: proposes path adjustments from diagnostic performance
 * (gap closure, reinforcement, or enrichment).
 * Returned concepts are intended to be inserted after the current concept.
 */
export async function generateAdaptiveConcepts(
  input: ConceptAgentInput,
): Promise<AdaptiveConceptCandidate[]> {
  const maxConcepts = Math.max(1, Math.min(3, input.maxConcepts ?? 2));

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a curriculum adaptation agent.

Given a student's diagnostic performance, propose 0-${maxConcepts} concepts that should be inserted immediately after the current concept.
This is not only remediation: you can also suggest reinforcement or enrichment concepts when they improve continuity of the path.

Topic: "${input.topicTitle}"
Current concept: "${input.conceptTitle}"
Current concept description: "${input.conceptDesc ?? ""}"
Future planned concepts (avoid duplicates and overlap): ${JSON.stringify(
          input.futureConceptTitles,
        )}

Diagnostic summary:
${JSON.stringify(input.diagnostic, null, 2)}

Rules:
- Generate concepts only if they improve this learner's path (gap closure, reinforcement, or enrichment).
- Each concept must be short, concrete, and teachable.
- Do not repeat existing or future concept titles.
- Keep the count minimal and high-impact.

Return ONLY a JSON array, no other text. Each element must have:
- "title": concept title
- "desc": one sentence description
- "reason": one sentence why this concept should be inserted based on gaps

Example:
[
  {
    "title": "Interpreting Augmented Matrices",
    "desc": "How matrix rows map to linear equations and solution meaning.",
    "reason": "Student confused matrix representation in multiple diagnostic answers."
  }
]`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const parsed = parseJsonResponse<AdaptiveConceptCandidate[]>(textBlock.text);
  if (!Array.isArray(parsed)) {
    throw new Error("Claude did not return a JSON array");
  }

  return parsed
    .filter((item) => item && typeof item.title === "string")
    .slice(0, maxConcepts);
}
