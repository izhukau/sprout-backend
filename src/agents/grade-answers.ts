import Anthropic from "@anthropic-ai/sdk";
import { parseJsonResponse } from "./parse-json";

const anthropic = new Anthropic();

export interface QuestionWithAnswer {
  questionId: string;
  prompt: string;
  format: "mcq" | "open_ended";
  correctAnswer: string;
  studentAnswer: string;
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean;
  score: number; // 0-1
  feedback: string;
}

/**
 * Grades all student answers for a diagnostic assessment in a single Claude call.
 * Returns per-question scores and feedback.
 */
export async function gradeAnswers(
  conceptTitle: string,
  questionsWithAnswers: QuestionWithAnswer[],
): Promise<GradedAnswer[]> {
  const qaPairs = questionsWithAnswers.map((qa, i) => ({
    index: i,
    questionId: qa.questionId,
    prompt: qa.prompt,
    format: qa.format,
    correctAnswer: qa.correctAnswer,
    studentAnswer: qa.studentAnswer,
  }));

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are an expert educator grading a diagnostic assessment on "${conceptTitle}".

Grade each of the following student answers. For MCQ questions, check if the student selected the correct option. For open-ended questions, evaluate semantic correctness — the student doesn't need to match the expected answer word-for-word, but must demonstrate understanding of the key concept.

Questions and answers:
${JSON.stringify(qaPairs, null, 2)}

Return ONLY a JSON array, no other text. Each element must have:
- "questionId": the questionId from the input
- "isCorrect": true if the answer is correct or substantially correct, false otherwise
- "score": number 0 to 1 (0 = completely wrong, 0.5 = partially correct, 1 = fully correct)
- "feedback": one sentence explaining why the answer is correct or what was wrong

Example:
[
  {"questionId": "abc-123", "isCorrect": true, "score": 1, "feedback": "Correct! Row swaps preserve the solution set."},
  {"questionId": "def-456", "isCorrect": false, "score": 0.3, "feedback": "You identified the right concept but confused eigenvalues with eigenvectors."}
]`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const parsed = parseJsonResponse<GradedAnswer[]>(textBlock.text);

  if (!Array.isArray(parsed)) {
    throw new Error("Claude did not return a JSON array");
  }

  return parsed;
}
