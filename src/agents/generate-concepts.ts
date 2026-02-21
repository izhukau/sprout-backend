import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";

const anthropic = new Anthropic();

export interface GeneratedConcept {
  title: string;
  desc: string;
}

/**
 * Calls Claude API to generate a linear educational path of concepts for a topic.
 * Returns an ordered array — each concept should be learned before the next one.
 *
 * @param topicTitle — root topic title, e.g. "Linear Algebra"
 * @param topicDesc  — optional description
 * @returns ordered array of 6-10 concepts forming a linear learning path
 */
export async function generateConcepts(
  topicTitle: string,
  topicDesc?: string | null,
): Promise<GeneratedConcept[]> {
  const descLine = topicDesc ? `Description: ${topicDesc}` : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an expert educator. Create a linear educational path for the following topic. The path should consist of 6-10 concepts ordered from foundational to advanced — each concept builds on the previous one.

Topic: "${topicTitle}"
${descLine}

The concepts should form a clear progression: a student learns concept 1, then concept 2 (which builds on 1), then concept 3 (which builds on 2), and so on.

Return ONLY a JSON array, no other text. Each element must have:
- "title": short name of the concept
- "desc": one sentence explaining what this concept covers

The order of the array IS the learning order (first element = first to learn).

Example for "Linear Algebra":
[
  {"title": "Systems of Linear Equations", "desc": "Formulating and understanding systems of linear equations and their solutions."},
  {"title": "Matrix Operations", "desc": "Addition, multiplication, and transposition of matrices."},
  {"title": "Gaussian Elimination", "desc": "Systematic method for solving systems using row reduction."},
  {"title": "Vector Spaces", "desc": "Definition and properties of vector spaces and subspaces."},
  {"title": "Linear Transformations", "desc": "Functions between vector spaces that preserve linear structure."},
  {"title": "Determinants", "desc": "Computing and interpreting determinants of square matrices."},
  {"title": "Eigenvalues and Eigenvectors", "desc": "Finding and applying eigenvalues and eigenvectors of matrices."},
  {"title": "Diagonalization", "desc": "Conditions and methods for diagonalizing a matrix."}
]`,
      },
    ],
  });

  // Extract text from Claude's response
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Parse JSON from the response (handles markdown code fences)
  const parsed = parseJsonResponse<GeneratedConcept[]>(textBlock.text);

  if (!Array.isArray(parsed)) {
    throw new Error("Claude did not return a JSON array");
  }

  return parsed;
}
