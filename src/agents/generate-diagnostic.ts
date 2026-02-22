import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";

const anthropic = new Anthropic();

export interface GeneratedQuestion {
  prompt: string;
  format: "mcq" | "open_ended";
  options?: string[]; // 4 options for MCQ
  correctAnswer: string;
  difficulty: number; // 1-5
}

/**
 * Generates exactly 10 diagnostic questions to assess a student's existing
 * knowledge of a concept before building the subconcept graph.
 */
export async function generateDiagnosticQuestions(
  conceptTitle: string,
  conceptDesc?: string | null,
  parentTopicTitle?: string | null,
): Promise<GeneratedQuestion[]> {
  const contextLine = parentTopicTitle
    ? `This concept is part of the broader topic "${parentTopicTitle}".`
    : "";

  const descLine = conceptDesc ? `Description: ${conceptDesc}` : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are an expert educator. Generate exactly 10 diagnostic questions to assess a student's existing knowledge of the following concept.

Concept: "${conceptTitle}"
${descLine}
${contextLine}

The questions should cover different depth levels and add up to exactly 10:
- 3 EASY questions (difficulty 1-2): basic definitions and recognition
- 4 MEDIUM questions (difficulty 3): application and understanding
- 3 HARD questions (difficulty 4-5): deeper analysis and connections

Mix question formats:
- "mcq": multiple choice with exactly 4 options (one correct)
- "open_ended": short answer (1-2 sentences expected)

Return ONLY a JSON array of length 10, no other text. Each element must have:
- "prompt": the question text
- "format": "mcq" or "open_ended"
- "options": array of 4 strings (ONLY for mcq, omit for open_ended)
- "correctAnswer": the correct answer (for mcq — the exact text of the correct option; for open_ended — the expected answer)
- "difficulty": integer 1-5

Example:
[
  {"prompt": "What is the primary purpose of Gaussian Elimination?", "format": "mcq", "options": ["To find eigenvalues", "To solve systems of linear equations", "To compute determinants", "To invert matrices"], "correctAnswer": "To solve systems of linear equations", "difficulty": 1},
  {"prompt": "Explain what happens to the solution set when you perform a row swap on an augmented matrix.", "format": "open_ended", "correctAnswer": "The solution set remains unchanged because row swaps are elementary row operations that produce equivalent systems.", "difficulty": 3}
]`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const parsed = parseJsonResponse<GeneratedQuestion[]>(textBlock.text);

  if (!Array.isArray(parsed)) {
    throw new Error("Claude did not return a JSON array");
  }

  return parsed;
}
