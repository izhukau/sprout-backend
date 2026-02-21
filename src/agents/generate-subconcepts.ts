import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";

const anthropic = new Anthropic();

export interface GeneratedSubconcept {
  title: string;
  desc: string;
  depends_on: string[]; // titles of subconcepts this one depends on
}

export interface SubconceptGenerationDiagnosticItem {
  questionId: string;
  prompt: string;
  format: "mcq" | "open_ended";
  difficulty: number;
  studentAnswer: string | null;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  score: number | null;
  feedback: string | null;
}

export interface SubconceptGenerationDiagnostic {
  assessmentId: string;
  answeredCount: number;
  totalQuestions: number;
  overallScore: number | null;
  strengths: string[];
  gaps: string[];
  items: SubconceptGenerationDiagnosticItem[];
}

/**
 * Calls Claude API to break a concept into subconcepts.
 * Subconcepts can depend on each other, forming a forest (multiple trees/chains).
 *
 * @param conceptTitle — concept node title, e.g. "Gaussian Elimination"
 * @param conceptDesc  — optional description
 * @param parentTopicTitle — parent topic title, e.g. "Linear Algebra"
 * @param diagnostic — optional student diagnostic summary to personalize output
 * @returns array of 8-12 subconcepts with title, desc, and dependencies
 */
export async function generateSubconcepts(
  conceptTitle: string,
  conceptDesc?: string | null,
  parentTopicTitle?: string | null,
  diagnostic?: SubconceptGenerationDiagnostic | null,
): Promise<GeneratedSubconcept[]> {
  const contextLine = parentTopicTitle
    ? `This concept is part of the broader topic "${parentTopicTitle}".`
    : "";

  const descLine = conceptDesc ? `Description: ${conceptDesc}` : "";
  const diagnosticLine = diagnostic
    ? `Student diagnostic summary (use this to adapt the subconcept graph):
${JSON.stringify(diagnostic, null, 2)}

Adaptation rules:
- Prioritize weak or missing areas in earlier/foundational subconcepts.
- Keep already-strong areas concise and placed later when possible.
- Add bridge subconcepts that explicitly close misconceptions shown in the diagnostic.
`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an expert educator. Break down the following concept into 8-12 subconcepts that a student needs to learn.

Concept: "${conceptTitle}"
${descLine}
${contextLine}
${diagnosticLine}

IMPORTANT: Subconcepts can depend on each other. Some are independent entry points, others require prior subconcepts to be understood first. This forms a forest (directed acyclic graph) — not a simple linear sequence.

Return ONLY a JSON array, no other text. Each element must have:
- "title": short name of the subconcept
- "desc": one sentence explaining what this subconcept covers
- "depends_on": array of titles of other subconcepts that must be learned before this one. Use an empty array [] if this subconcept has no prerequisites.

Example format:
[
  {"title": "Row Operations", "desc": "The three elementary row operations used to transform matrices.", "depends_on": []},
  {"title": "Echelon Form", "desc": "How to reduce a matrix to row echelon form step by step.", "depends_on": ["Row Operations"]},
  {"title": "Back Substitution", "desc": "Solving the system from the echelon form by substituting backwards.", "depends_on": ["Echelon Form"]},
  {"title": "Matrix Notation", "desc": "Representing a system of linear equations as an augmented matrix.", "depends_on": []},
  {"title": "Pivoting Strategies", "desc": "Choosing the best pivot to avoid numerical instability.", "depends_on": ["Row Operations", "Echelon Form"]}
]`,
      },
    ],
  });

  // Extract text from Claude's response
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Parse JSON from the response (also handles markdown code fences)
  const parsed = parseJsonResponse<GeneratedSubconcept[]>(textBlock.text);

  if (!Array.isArray(parsed)) {
    throw new Error("Claude did not return a JSON array");
  }

  return parsed;
}
