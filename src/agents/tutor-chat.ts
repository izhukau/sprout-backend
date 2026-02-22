import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop, type AgentTool } from "./agent-loop";
import { db } from "../db";
import {
  assessments,
  questions,
  answers,
  userNodeProgress,
  nodes,
  nodeEdges,
} from "../db/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export interface ChatMessage {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

export interface TutorResponse {
  content: string;
  isComplete: boolean;
  chunkTransition: "advance" | "same" | null;
  toolsUsed: string[];
  reasoning: string[];
}

export type TutorQuestionType = "text" | "code" | "draw";

function toPlainTextContent(
  content: Anthropic.MessageParam["content"],
): string {
  if (typeof content === "string") return content;

  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[Drawing image attached]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Tutor Agent — teaches a subconcept chunk-by-chunk using tools.
 * Uses the agent loop with tools for generating examples, exercises, and diagrams.
 *
 * @param subconceptTitle — e.g. "Row Operations"
 * @param subconceptDesc — e.g. "The three elementary row operations..."
 * @param parentConceptTitle — e.g. "Gaussian Elimination"
 * @param messages — conversation history so far
 * @returns AI response + whether the tutoring session is complete + tools used
 */
export async function tutorRespond(
  subconceptTitle: string,
  subconceptDesc: string | null,
  parentConceptTitle: string | null,
  messages: ChatMessage[],
  context?: {
    userId: string;
    subconceptNodeId: string;
    conceptNodeId: string;
    sessionId: string;
  },
): Promise<TutorResponse> {
  const contextLine = parentConceptTitle
    ? `This subconcept is part of the broader concept "${parentConceptTitle}".`
    : "";

  const descLine = subconceptDesc || "No additional description provided.";

  const tools: AgentTool[] = [
    {
      name: "generate_example",
      description:
        "Generate a concrete, worked example to illustrate the current concept. Use this when the student needs to see a real application of what they're learning. Returns a formatted example with step-by-step walkthrough.",
      input_schema: {
        type: "object" as const,
        properties: {
          topic: {
            type: "string",
            description: "What specific aspect to create an example for",
          },
          difficulty: {
            type: "string",
            enum: ["simple", "moderate", "challenging"],
            description: "How complex the example should be",
          },
        },
        required: ["topic"],
      },
      async execute(input: { topic: string; difficulty?: string }) {
        // The tool signals to the agent that it should produce a worked example.
        // The result is a structured prompt that the agent incorporates.
        return JSON.stringify({
          type: "worked_example",
          topic: input.topic,
          difficulty: input.difficulty ?? "moderate",
          instruction:
            "Present a concrete worked example with clear step-by-step reasoning. Use real numbers or scenarios. Show the process, not just the answer.",
        });
      },
    },
    {
      name: "create_exercise",
      description:
        "Create a practice problem for the student to try. Use this when the student has understood the explanation and should practice. Returns a problem with a hidden solution for verification.",
      input_schema: {
        type: "object" as const,
        properties: {
          topic: {
            type: "string",
            description: "What concept the exercise should test",
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "Exercise difficulty level",
          },
        },
        required: ["topic"],
      },
      async execute(input: { topic: string; difficulty?: string }) {
        return JSON.stringify({
          type: "practice_exercise",
          topic: input.topic,
          difficulty: input.difficulty ?? "medium",
          instruction:
            "Create a practice problem. Present ONLY the problem to the student. Keep the solution internally so you can check their answer. Ask them to solve it.",
        });
      },
    },
    {
      name: "visualize_concept",
      description:
        "Create a text/ASCII diagram to visually explain a concept. Use this when a visual representation would help — e.g., showing relationships, processes, hierarchies, or data structures.",
      input_schema: {
        type: "object" as const,
        properties: {
          what: {
            type: "string",
            description:
              "What to visualize (e.g., 'matrix multiplication process', 'tree traversal order')",
          },
          style: {
            type: "string",
            enum: ["diagram", "table", "flowchart", "comparison"],
            description: "Type of visualization",
          },
        },
        required: ["what"],
      },
      async execute(input: { what: string; style?: string }) {
        return JSON.stringify({
          type: "visualization",
          what: input.what,
          style: input.style ?? "diagram",
          instruction:
            "Create a clear ASCII/text visualization. Use boxes, arrows, and alignment for clarity. Keep it compact but readable.",
        });
      },
    },
    {
      name: "check_student_progress",
      description:
        "Check the student's diagnostic results for the parent concept — see what they got right/wrong and identify weak areas. Call this at the start of a tutoring session.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        if (!context) {
          return JSON.stringify({ error: "No student context available" });
        }

        // Find the latest diagnostic assessment for the concept
        const diagnosticResults = await db
          .select()
          .from(assessments)
          .where(
            and(
              eq(assessments.userId, context.userId),
              eq(assessments.targetNodeId, context.conceptNodeId),
              eq(assessments.type, "diagnostic"),
            ),
          )
          .orderBy(desc(assessments.createdAt));

        if (!diagnosticResults.length) {
          return JSON.stringify({
            diagnosticScore: null,
            message: "No diagnostic found for this concept.",
          });
        }

        const latestDiagnostic = diagnosticResults[0];

        // Get questions and answers
        const diagnosticQuestions = await db
          .select()
          .from(questions)
          .where(eq(questions.assessmentId, latestDiagnostic.id));

        const questionIds = diagnosticQuestions.map((q) => q.id);
        let studentAnswers: (typeof answers.$inferSelect)[] = [];
        if (questionIds.length) {
          studentAnswers = await db
            .select()
            .from(answers)
            .where(
              and(
                eq(answers.userId, context.userId),
                inArray(answers.questionId, questionIds),
              ),
            );
        }

        const answerByQuestion = new Map(
          studentAnswers.map((a) => [a.questionId, a]),
        );

        const scoredItems = diagnosticQuestions.map((q) => {
          const a = answerByQuestion.get(q.id);
          return {
            prompt: q.prompt,
            isCorrect: a?.isCorrect ?? null,
            score: a?.score ?? null,
            feedback: a?.feedback ?? null,
          };
        });

        const scores = scoredItems
          .map((i) => i.score)
          .filter((s): s is number => s !== null);

        const diagnosticScore = scores.length
          ? Number(
              (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3),
            )
          : null;

        const incorrectQuestions = scoredItems
          .filter(
            (i) => i.isCorrect === false || (i.score !== null && i.score < 0.7),
          )
          .map((i) => ({ prompt: i.prompt, feedback: i.feedback }));

        return JSON.stringify({
          diagnosticScore,
          totalQuestions: diagnosticQuestions.length,
          incorrectQuestions,
          weakAreas: incorrectQuestions.map((q) => q.prompt).slice(0, 5),
        });
      },
    },
    {
      name: "check_prerequisite_mastery",
      description:
        "Check if prerequisite subconcepts have been mastered. Call this before teaching to know if you need to review earlier material.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        if (!context) {
          return JSON.stringify({ error: "No student context available" });
        }

        // Find incoming edges to this subconcept (prerequisites)
        const incomingEdges = await db
          .select()
          .from(nodeEdges)
          .where(eq(nodeEdges.targetNodeId, context.subconceptNodeId));

        if (!incomingEdges.length) {
          return JSON.stringify({
            prerequisites: [],
            allMastered: true,
            message: "No prerequisites for this subconcept.",
          });
        }

        const prereqIds = incomingEdges.map((e) => e.sourceNodeId);

        // Get prerequisite node details
        const prereqNodes = await db
          .select()
          .from(nodes)
          .where(inArray(nodes.id, prereqIds));

        // Get progress for prerequisites
        const prereqProgress = await db
          .select()
          .from(userNodeProgress)
          .where(
            and(
              eq(userNodeProgress.userId, context.userId),
              inArray(userNodeProgress.nodeId, prereqIds),
            ),
          );

        const progressByNode = new Map(
          prereqProgress.map((p) => [p.nodeId, p]),
        );

        const prerequisites = prereqNodes.map((n) => {
          const progress = progressByNode.get(n.id);
          return {
            title: n.title,
            mastered: (progress?.masteryScore ?? 0) >= 0.7,
            masteryScore: progress?.masteryScore ?? 0,
          };
        });

        const allMastered = prerequisites.every((p) => p.mastered);

        return JSON.stringify({ prerequisites, allMastered });
      },
    },
    {
      name: "record_exercise_result",
      description:
        "Record a student's exercise attempt and update their mastery score. Call this after evaluating a student's answer to an exercise.",
      input_schema: {
        type: "object" as const,
        properties: {
          exercise_prompt: {
            type: "string",
            description: "The exercise question that was asked",
          },
          student_answer: {
            type: "string",
            description: "The student's answer",
          },
          is_correct: {
            type: "boolean",
            description: "Whether the answer was correct",
          },
          score: { type: "number", description: "Score from 0 to 1" },
          feedback: {
            type: "string",
            description: "Feedback given to the student",
          },
        },
        required: ["exercise_prompt", "student_answer", "is_correct", "score"],
      },
      async execute(input: {
        exercise_prompt: string;
        student_answer: string;
        is_correct: boolean;
        score: number;
        feedback?: string;
      }) {
        if (!context) {
          return JSON.stringify({ error: "No student context available" });
        }

        // Create or get quiz assessment for this subconcept
        let quizAssessment = await db
          .select()
          .from(assessments)
          .where(
            and(
              eq(assessments.userId, context.userId),
              eq(assessments.targetNodeId, context.subconceptNodeId),
              eq(assessments.type, "quiz"),
            ),
          );

        let assessmentId: string;
        if (quizAssessment.length) {
          assessmentId = quizAssessment[0].id;
        } else {
          assessmentId = uuid();
          await db.insert(assessments).values({
            id: assessmentId,
            userId: context.userId,
            targetNodeId: context.subconceptNodeId,
            type: "quiz",
            title: `Practice for ${subconceptTitle}`,
          });
        }

        // Insert question
        const questionId = uuid();
        await db.insert(questions).values({
          id: questionId,
          assessmentId,
          nodeId: context.subconceptNodeId,
          format: "open_ended",
          prompt: input.exercise_prompt,
          correctAnswer: null,
          difficulty: 3,
        });

        // Insert answer
        await db.insert(answers).values({
          id: uuid(),
          userId: context.userId,
          assessmentId,
          questionId,
          answerText: input.student_answer,
          isCorrect: input.is_correct,
          score: input.score,
          feedback: input.feedback ?? null,
        });

        // Compute updated mastery from all answers for this subconcept's quiz
        const allQuizQuestions = await db
          .select()
          .from(questions)
          .where(eq(questions.assessmentId, assessmentId));

        const allQuestionIds = allQuizQuestions.map((q) => q.id);
        let allAnswers: (typeof answers.$inferSelect)[] = [];
        if (allQuestionIds.length) {
          allAnswers = await db
            .select()
            .from(answers)
            .where(
              and(
                eq(answers.userId, context.userId),
                inArray(answers.questionId, allQuestionIds),
              ),
            );
        }

        const totalAttempts = allAnswers.length;
        const correctCount = allAnswers.filter((a) => a.isCorrect).length;
        const allScores = allAnswers
          .map((a) => a.score)
          .filter((s): s is number => s !== null);
        const averageScore = allScores.length
          ? Number(
              (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(
                3,
              ),
            )
          : input.score;

        // Update mastery score in userNodeProgress
        const existingProgress = await db
          .select()
          .from(userNodeProgress)
          .where(
            and(
              eq(userNodeProgress.userId, context.userId),
              eq(userNodeProgress.nodeId, context.subconceptNodeId),
            ),
          );

        const now = new Date().toISOString();
        if (existingProgress.length) {
          await db
            .update(userNodeProgress)
            .set({
              masteryScore: averageScore,
              attemptsCount: totalAttempts,
              updatedAt: now,
            })
            .where(eq(userNodeProgress.id, existingProgress[0].id));
        } else {
          await db.insert(userNodeProgress).values({
            id: uuid(),
            userId: context.userId,
            nodeId: context.subconceptNodeId,
            firstEnteredAt: now,
            lastEnteredAt: now,
            masteryScore: averageScore,
            attemptsCount: totalAttempts,
          });
        }

        return JSON.stringify({
          recorded: true,
          totalAttempts,
          correctCount,
          averageScore,
          shouldMoveOn: averageScore >= 0.7 && totalAttempts >= 2,
        });
      },
    },
  ];

  const systemPrompt = `You are an expert tutor teaching a student about "${subconceptTitle}".
${contextLine}
Description: ${descLine}

YOU HAVE TOOLS. Use them actively to enhance your teaching:
- check_student_progress: Check diagnostic results at the start of a session
- check_prerequisite_mastery: Verify prerequisites are mastered before teaching
- generate_example: When the student needs a concrete illustration
- create_exercise: When they should practice what they learned
- visualize_concept: When a diagram would help understanding
- record_exercise_result: After evaluating a student's exercise answer

BEFORE TEACHING:
- Call check_student_progress to see diagnostic results and weak areas.
- Call check_prerequisite_mastery to verify prerequisites are mastered.
- If prerequisites NOT mastered, briefly review key concepts first.

YOUR TEACHING METHOD:
1. Break this subconcept into small, digestible chunks (aim for 4-8, NEVER exceed 10 chunks total).
   Remediation steps for incorrect answers do NOT count toward the chunk total — loop on the same chunk as many times as needed until the student answers correctly.
2. For each chunk:
   - Explain the chunk clearly and concisely (2-4 sentences).
   - Use your tools when appropriate — a good example or diagram can be more effective than explanation alone.
   - Then ask ONE specific question to check the student's understanding.
3. Wait for the student's answer before moving on.

RESPONSE FORMAT:
- For regular tutoring turns (start + after [ANSWER]):
  - Explanation block first.
  - Then a line that starts exactly with: "Question Type:" and one value from: text | code | draw
    Choose the type that best fits what the question asks the student to produce:
    * text  — conceptual explanations, definitions, reasoning, short factual answers, or anything answered in plain language.
    * code  — writing code, pseudocode, algorithms, SQL queries, shell commands, or any programming-related output. Use this whenever the subconcept is about programming, data structures, or computation and the question asks the student to write or complete code.
    * draw  — sketching diagrams, graphs, circuits, geometric figures, flowcharts, data-structure visualizations, or any spatial/visual representation. Use this whenever a drawn picture, plot, or diagram would be the most natural way to answer.
    Actively vary the question type based on the subject matter. Do NOT default to "text" when "code" or "draw" would be more appropriate.
  - Then a separate checkpoint question block that starts exactly with: "Question:"
  - Always include exactly one question in that block.
- For [CLARIFICATION] turns:
  - Return only the clarification explanation.
  - Do NOT include "Question Type:".
  - Do NOT include a "Question:" block.

MESSAGE TAGS:
- Student messages can start with [ANSWER] or [CLARIFICATION].
- [ANSWER] means this is an attempt to answer your current checkpoint question.
- [CLARIFICATION] means the student asked a side question and did NOT answer the checkpoint question yet.
- Some [ANSWER] messages can include an attached drawing image (tablet/handwritten solution).
- If a drawing image is attached, use it as primary evidence when evaluating correctness.

EVALUATION RULES:
- If message is [CLARIFICATION]:
  - answer the side question briefly;
  - DO NOT advance to the next chunk;
  - do NOT ask a new checkpoint question;
  - do NOT repeat the current checkpoint question.
- If the student answers CORRECTLY: praise briefly, then move to the next chunk (explain + question).
- If the student answers INCORRECTLY: do NOT reveal the correct answer. Give a helpful hint, then ask them to try the SAME checkpoint question again.
- If the student says they don't know or seems confused while answering: explain from a simpler angle, then ask them the SAME checkpoint question again.
- After evaluating exercise answers, call record_exercise_result to persist the result and check if the student should move on.

TOOL USAGE GUIDELINES:
- Use generate_example for the FIRST chunk to ground the concept in something concrete.
- Use create_exercise when transitioning between chunks or when the student needs practice.
- Use visualize_concept when relationships or processes are involved.
- Don't overuse tools — 1-2 per response is ideal.

COMPLETION:
- When all chunks have been covered and the student has answered the final question correctly, write a brief summary of everything learned and end your message with the exact marker: [COMPLETE]
- Only use [COMPLETE] when truly done with all chunks.

CHUNK TRANSITION MARKERS (for [ANSWER] turns only):
- If you are moving to the NEXT chunk, append exactly: [ADVANCE_CHUNK]
- If the student should stay on the SAME chunk (incorrect/confused/retry), append exactly: [SAME_CHUNK]
- Do not include these markers for clarification turns.

STYLE:
- Be encouraging but not overly enthusiastic.
- Use simple language. Give concrete examples where helpful.
- Keep each response focused — one chunk at a time.
- Format with markdown when it helps readability.`;

  const conversationHistory =
    messages.length > 0
      ? messages.map((message) => ({
          role: message.role,
          content: toPlainTextContent(message.content),
        }))
      : [
          {
            role: "user" as const,
            content: "I'm ready to learn. Please start teaching me.",
          },
        ];

  const reasoningSteps: string[] = [];

  const result = await runAgentLoop({
    model: "claude-sonnet-4-6",
    systemPrompt,
    tools,
    conversationHistory,
    maxIterations: 5,
    callbacks: {
      onThinking(text) {
        reasoningSteps.push(text);
      },
    },
  });

  const rawContent = result.finalText;
  const isComplete = rawContent.includes("[COMPLETE]");
  const hasAdvanceMarker = rawContent.includes("[ADVANCE_CHUNK]");
  const hasSameMarker = rawContent.includes("[SAME_CHUNK]");
  const chunkTransition: "advance" | "same" | null = hasAdvanceMarker
    ? "advance"
    : hasSameMarker
      ? "same"
      : null;
  const cleanedContent = rawContent
    .replace("[COMPLETE]", "")
    .replace("[ADVANCE_CHUNK]", "")
    .replace("[SAME_CHUNK]", "")
    .trim();

  return {
    content: cleanedContent,
    isComplete,
    chunkTransition,
    toolsUsed: result.toolCalls.map((tc) => tc.name),
    reasoning: reasoningSteps,
  };
}
