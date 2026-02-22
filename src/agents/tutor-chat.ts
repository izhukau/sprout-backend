import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export interface ChatMessage {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

export interface TutorResponse {
  content: string;
  isComplete: boolean;
}

export type TutorQuestionType = "text" | "code" | "draw";

/**
 * Sends the conversation to Claude with a tutoring system prompt.
 * Claude teaches a subconcept chunk-by-chunk, asking questions after each part.
 *
 * @param subconceptTitle — e.g. "Row Operations"
 * @param subconceptDesc — e.g. "The three elementary row operations..."
 * @param parentConceptTitle — e.g. "Gaussian Elimination"
 * @param messages — conversation history so far
 * @returns AI response + whether the tutoring session is complete
 */
export async function tutorRespond(
  subconceptTitle: string,
  subconceptDesc: string | null,
  parentConceptTitle: string | null,
  messages: ChatMessage[],
  preferredNextQuestionType: TutorQuestionType | null = null,
): Promise<TutorResponse> {
  const contextLine = parentConceptTitle
    ? `This subconcept is part of the broader concept "${parentConceptTitle}".`
    : "";

  const descLine = subconceptDesc || "No additional description provided.";
  const preferredQuestionTypeLine = preferredNextQuestionType
    ? `NEXT QUESTION TYPE PREFERENCE (for this response):
- The student requested the next checkpoint question type to be "${preferredNextQuestionType}".
- If you include a checkpoint question in this response, you MUST use exactly: "Question Type: ${preferredNextQuestionType}".
- The checkpoint question itself must match that format.
`
    : "";

  const systemPrompt = `You are an expert tutor teaching a student about "${subconceptTitle}".
${contextLine}
Description: ${descLine}
${preferredQuestionTypeLine}

YOUR TEACHING METHOD:
1. Break this subconcept into small, digestible chunks (3-6 chunks total).
2. For each chunk:
   - Explain the chunk clearly and concisely (2-4 sentences).
   - Then ask ONE specific question to check the student's understanding.
3. Wait for the student's answer before moving on.

RESPONSE FORMAT:
- For regular tutoring turns (start + after [ANSWER]):
  - Explanation block first.
  - Then a line that starts exactly with: "Question Type:" and one value from: text | code | draw
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

COMPLETION:
- When all chunks have been covered and the student has answered the final question correctly, write a brief summary of everything learned and end your message with the exact marker: [COMPLETE]
- Only use [COMPLETE] when truly done with all chunks.

STYLE:
- Be encouraging but not overly enthusiastic.
- Use simple language. Give concrete examples where helpful.
- Keep each response focused — one chunk at a time.
- Format with markdown when it helps readability.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages:
      messages.length > 0
        ? messages.map((m) => ({ role: m.role, content: m.content }))
        : [
            {
              role: "user",
              content: "I'm ready to learn. Please start teaching me.",
            },
          ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const content = textBlock.text;
  const isComplete = content.includes("[COMPLETE]");

  return {
    content: content.replace("[COMPLETE]", "").trim(),
    isComplete,
  };
}
