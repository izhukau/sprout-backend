import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TutorResponse {
  content: string;
  isComplete: boolean;
}

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
): Promise<TutorResponse> {
  const contextLine = parentConceptTitle
    ? `This subconcept is part of the broader concept "${parentConceptTitle}".`
    : "";

  const descLine = subconceptDesc || "No additional description provided.";

  const systemPrompt = `You are an expert tutor teaching a student about "${subconceptTitle}".
${contextLine}
Description: ${descLine}

YOUR TEACHING METHOD:
1. Break this subconcept into small, digestible chunks (3-6 chunks total).
2. For each chunk:
   - Explain the chunk clearly and concisely (2-4 sentences).
   - Then ask ONE specific question to check the student's understanding.
3. Wait for the student's answer before moving on.

EVALUATION RULES:
- If the student answers CORRECTLY: praise briefly, then move to the next chunk (explain + question).
- If the student answers INCORRECTLY: do NOT reveal the correct answer. Instead, give a helpful hint that guides them toward the right answer, and ask them to try again.
- If the student says they don't know, asks for help, or seems confused: explain the same concept from a different angle or with a simpler example, then ask a NEW (different, easier) question about the same chunk. Only proceed to the next chunk after they answer this new question correctly.

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
    messages: messages.length > 0
      ? messages.map((m) => ({ role: m.role, content: m.content }))
      : [{ role: "user", content: "I'm ready to learn. Please start teaching me." }],
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
