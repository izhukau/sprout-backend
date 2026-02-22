import { Router } from "express";
import { db } from "../db";
import { chatSessions, chatMessages, hintEvents, nodes, nodeContents } from "../db/schema";
import { and, eq, asc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { tutorRespond, type ChatMessage } from "../agents/tutor-chat";

const router = Router();
type TutorQuestionType = "text" | "code" | "draw";
const QUESTION_TYPES = new Set<TutorQuestionType>(["text", "code", "draw"]);
type DrawAttachment = {
  mediaType: "image/png" | "image/jpeg";
  base64Data: string;
};

function normalizeQuestionType(raw: string): TutorQuestionType | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "text") return "text";
  if (normalized === "code") return "code";
  if (normalized === "draw" || normalized === "drawing") return "draw";
  if (
    normalized === "mcp" ||
    normalized === "mcq" ||
    normalized === "multiple choice" ||
    normalized === "multiple choices" ||
    normalized === "multiple choice question"
  ) {
    return "text";
  }

  return QUESTION_TYPES.has(normalized as TutorQuestionType)
    ? (normalized as TutorQuestionType)
    : null;
}

function parseDrawingDataUrl(input: string): DrawAttachment | null {
  const trimmed = input.trim();
  const match = trimmed.match(
    /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/i,
  );
  if (!match?.[1] || !match[2]) return null;

  const mediaType = match[1].toLowerCase();
  if (mediaType !== "image/png" && mediaType !== "image/jpeg") return null;

  const base64Data = match[2];
  if (base64Data.length > 7_000_000) return null;

  return { mediaType, base64Data };
}

function normalizeQuestionLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*>]|\d+[.)])\s+/, "")
    .replace(/^\s*(checkpoint\s+question|new\s+question|question)\s*:\s*/i, "")
    .trim();
}

function stripQuestionLinePrefix(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*>]|\d+[.)])\s+/, "")
    .trim();
}

function toMarkerComparable(line: string): string {
  return stripQuestionLinePrefix(line)
    .replace(/[*_`~]/g, "")
    .trim();
}

function isQuestionMarkerOnly(line: string): boolean {
  return /^(checkpoint\s+question|new\s+question|question)\s*:?\s*$/i.test(
    toMarkerComparable(line),
  );
}

function extractInlineQuestion(line: string): string | null {
  const stripped = stripQuestionLinePrefix(line);
  const colonIndex = stripped.indexOf(":");
  if (colonIndex === -1) return null;

  const marker = stripped
    .slice(0, colonIndex)
    .replace(/[*_`~]/g, "")
    .trim();
  if (!/^(checkpoint\s+question|new\s+question|question)$/i.test(marker)) {
    return null;
  }

  const questionBody = stripped
    .slice(colonIndex + 1)
    .replace(/^\s*[*_`~]+\s*/, "")
    .trim();
  const text = normalizeQuestionLine(questionBody);
  return text || null;
}

function hasInlineQuestion(line: string): boolean {
  return /^(checkpoint\s+question|new\s+question|question)\s*:\s*.+$/i.test(
    toMarkerComparable(line),
  );
}

function extractInlineQuestionType(line: string): TutorQuestionType | null {
  const stripped = stripQuestionLinePrefix(line);
  const match = stripped.match(
    /^\s*(question\s*type|question-type)\s*[:\-–—]\s*(.+)\s*$/i,
  );
  if (!match?.[2]) return null;

  return normalizeQuestionType(match[2]);
}

function extractQuestionFromTutorMessage(content: string): string | null {
  const normalized = content.replaceAll("\r\n", "\n").trim();
  if (!normalized) return null;

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    if (!isQuestionMarkerOnly(lines[i])) continue;

    const questionParts: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (isQuestionMarkerOnly(lines[j]) || hasInlineQuestion(lines[j])) {
        break;
      }
      const normalizedLine = normalizeQuestionLine(lines[j]);
      if (normalizedLine) questionParts.push(normalizedLine);
    }
    const questionText = questionParts.join(" ").trim();

    if (questionText) return questionText;
  }

  for (let i = 0; i < lines.length; i++) {
    const inlineQuestionHead = extractInlineQuestion(lines[i]);
    if (!inlineQuestionHead) continue;

    const questionParts: string[] = [inlineQuestionHead];
    for (let j = i + 1; j < lines.length; j++) {
      if (isQuestionMarkerOnly(lines[j]) || hasInlineQuestion(lines[j])) {
        break;
      }
      if (extractInlineQuestionType(lines[j])) continue;
      questionParts.push(lines[j]);
    }

    return questionParts.join(" ").trim();
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = normalizeQuestionLine(lines[i]);
    if (candidate.endsWith("?")) return candidate;
  }

  return null;
}

function extractQuestionTypeFromTutorMessage(
  content: string,
): TutorQuestionType | null {
  const normalized = content.replaceAll("\r\n", "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  for (const line of lines) {
    const questionType = extractInlineQuestionType(line);
    if (questionType) return questionType;
  }

  return null;
}

function applyForcedQuestionType(
  content: string,
  forcedQuestionType: TutorQuestionType | null,
): string {
  const trimmed = content.trim();
  if (!forcedQuestionType) return trimmed;

  const lines = trimmed ? trimmed.split("\n") : [];
  const rewritten: string[] = [];
  let replaced = false;

  for (const line of lines) {
    const comparable = toMarkerComparable(line).toLowerCase();
    if (
      comparable.startsWith("question type:") ||
      comparable.startsWith("question-type:")
    ) {
      if (!replaced) {
        rewritten.push(`Question Type: ${forcedQuestionType}`);
        replaced = true;
      }
      continue;
    }
    rewritten.push(line);
  }

  const result = rewritten.join("\n").trim();
  if (replaced) return result;
  if (!result) return `Question Type: ${forcedQuestionType}`;

  const markerIndex = rewritten.findIndex(
    (line) => isQuestionMarkerOnly(line) || hasInlineQuestion(line),
  );
  if (markerIndex === -1) {
    return `${result}\n\nQuestion Type: ${forcedQuestionType}`.trim();
  }

  const before = rewritten.slice(0, markerIndex).join("\n").trimEnd();
  const after = rewritten.slice(markerIndex).join("\n").trimStart();
  if (!before) {
    return `Question Type: ${forcedQuestionType}\n\n${after}`.trim();
  }

  return `${before}\n\nQuestion Type: ${forcedQuestionType}\n\n${after}`.trim();
}

function isQuestionLikelyIncomplete(question: string | null): boolean {
  if (!question) return true;
  const trimmed = question.trim();
  if (!trimmed) return true;
  if (trimmed.length < 12) return true;
  return /[:\-]\s*$/.test(trimmed);
}

function defaultQuestionForType(questionType: TutorQuestionType): string {
  if (questionType === "code") {
    return "Write runnable code or clear pseudocode that solves this checkpoint, then explain your logic briefly.";
  }
  if (questionType === "draw") {
    return "Draw your step-by-step solution and add a short explanation of why your final result is correct.";
  }
  return "What is the key idea from this chunk, in your own words?";
}

function ensureTutorQuestion(
  content: string,
  fallbackQuestion: string | null,
  fallbackQuestionType: TutorQuestionType | null,
  isComplete: boolean,
  forcedQuestionType: TutorQuestionType | null = null,
): string {
  const trimmed = content.trim();
  if (isComplete) {
    return trimmed;
  }

  const extractedQuestion = extractQuestionFromTutorMessage(trimmed);
  const hasQuestion = !isQuestionLikelyIncomplete(extractedQuestion);
  const baseContent =
    extractedQuestion && !hasQuestion
      ? stripTutorQuestionForClarification(trimmed)
      : trimmed;
  const hasQuestionType = Boolean(
    extractQuestionTypeFromTutorMessage(baseContent),
  );
  const questionType = fallbackQuestionType ?? "text";

  if (hasQuestion && hasQuestionType) {
    return applyForcedQuestionType(baseContent, forcedQuestionType);
  }

  if (hasQuestion) {
    if (!baseContent) return `Question Type: ${questionType}`;
    return applyForcedQuestionType(
      `${baseContent}\n\nQuestion Type: ${questionType}`,
      forcedQuestionType,
    );
  }

  const question = !isQuestionLikelyIncomplete(fallbackQuestion)
    ? fallbackQuestion!.trim()
    : defaultQuestionForType(questionType);

  if (!baseContent) {
    return applyForcedQuestionType(
      `Question Type: ${questionType}\n\nQuestion:\n${question}`,
      forcedQuestionType,
    );
  }

  return applyForcedQuestionType(
    `${baseContent}\n\nQuestion Type: ${questionType}\n\nQuestion:\n${question}`,
    forcedQuestionType,
  );
}

function stripTutorQuestionForClarification(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const comparable = toMarkerComparable(line).toLowerCase();

    if (
      comparable.startsWith("question type:") ||
      comparable.startsWith("question-type:")
    ) {
      continue;
    }

    if (
      /^(checkpoint\s+question|new\s+question|question)\s*:?\s*$/i.test(
        comparable,
      )
    ) {
      break;
    }
    if (
      /^(checkpoint\s+question|new\s+question|question)\s*:/i.test(comparable)
    ) {
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n").trim();
}

// --- Sessions ---

// GET /api/chat/sessions?userId=&nodeId=
router.get("/sessions", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.query as Record<string, string>;
    const conditions = [];
    if (userId) conditions.push(eq(chatSessions.userId, userId));
    if (nodeId) conditions.push(eq(chatSessions.nodeId, nodeId));
    const query = conditions.length
      ? db
          .select()
          .from(chatSessions)
          .where(and(...conditions))
      : db.select().from(chatSessions);
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/sessions
router.post("/sessions", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const id = uuid();
    await db.insert(chatSessions).values({
      id,
      userId,
      nodeId: nodeId || null,
    });
    const created = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/chat/sessions/:id (end session)
router.patch("/sessions/:id", async (req, res, next) => {
  try {
    const { endedAt } = req.body;
    await db
      .update(chatSessions)
      .set({ endedAt: endedAt || new Date().toISOString() })
      .where(eq(chatSessions.id, req.params.id));
    const updated = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, req.params.id));
    if (!updated.length)
      return res.status(404).json({ error: "Session not found" });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

// --- Messages ---

// GET /api/chat/sessions/:sessionId/messages
router.get("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const result = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, req.params.sessionId));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /api/chat/sessions/:sessionId/messages
router.post("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const { userId, role, kind, content, wasSuccessful, successSignal } =
      req.body;
    if (!userId || !role || !content)
      return res
        .status(400)
        .json({ error: "userId, role, and content are required" });
    const id = uuid();
    await db.insert(chatMessages).values({
      id,
      sessionId: req.params.sessionId,
      userId,
      role,
      kind: kind || "learning",
      content,
      wasSuccessful: wasSuccessful ?? null,
      successSignal: successSignal ? JSON.stringify(successSignal) : null,
    });
    const created = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// --- Hint Events ---

// POST /api/chat/hints
router.post("/hints", async (req, res, next) => {
  try {
    const {
      userId,
      nodeId,
      sessionId,
      requestMessageId,
      responseMessageId,
      referencedSuccessMessageIds,
    } = req.body;
    if (!userId || !nodeId)
      return res.status(400).json({ error: "userId and nodeId are required" });
    const id = uuid();
    await db.insert(hintEvents).values({
      id,
      userId,
      nodeId,
      sessionId: sessionId || null,
      requestMessageId: requestMessageId || null,
      responseMessageId: responseMessageId || null,
      referencedSuccessMessageIds: referencedSuccessMessageIds
        ? JSON.stringify(referencedSuccessMessageIds)
        : null,
    });
    const created = await db
      .select()
      .from(hintEvents)
      .where(eq(hintEvents.id, id));
    res.status(201).json(created[0]);
  } catch (e) {
    next(e);
  }
});

// GET /api/chat/hints?userId=&nodeId=
router.get("/hints", async (req, res, next) => {
  try {
    const { userId, nodeId } = req.query as Record<string, string>;
    const conditions = [];
    if (userId) conditions.push(eq(hintEvents.userId, userId));
    if (nodeId) conditions.push(eq(hintEvents.nodeId, nodeId));
    const query = conditions.length
      ? db
          .select()
          .from(hintEvents)
          .where(and(...conditions))
      : db.select().from(hintEvents);
    const result = await query;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// --- Tutor ---

// POST /api/chat/sessions/:sessionId/tutor
// Interactive tutoring: send student message, get AI tutor response.
// Send empty content to start the session.
router.post("/sessions/:sessionId/tutor", async (req, res, next) => {
  try {
    const { userId, content, drawingImageDataUrl } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const trimmedContent = typeof content === "string" ? content.trim() : "";
    const isClarificationTurn = trimmedContent.startsWith("[CLARIFICATION]");
    const isAnswerTurn = trimmedContent.startsWith("[ANSWER]");
    const drawAttachment =
      isAnswerTurn && typeof drawingImageDataUrl === "string"
        ? parseDrawingDataUrl(drawingImageDataUrl)
        : null;

    // 1. Load the session
    const sessionResult = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, req.params.sessionId));
    if (!sessionResult.length)
      return res.status(404).json({ error: "Session not found" });

    const session = sessionResult[0];
    if (!session.nodeId)
      return res.status(400).json({ error: "Session has no linked node" });

    // 2. Load the subconcept node + parent concept
    const nodeResult = await db
      .select()
      .from(nodes)
      .where(eq(nodes.id, session.nodeId));
    if (!nodeResult.length)
      return res.status(404).json({ error: "Node not found" });

    const node = nodeResult[0];

    let parentConceptTitle: string | null = null;
    if (node.parentId) {
      const parentResult = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, node.parentId));
      if (parentResult.length) parentConceptTitle = parentResult[0].title;
    }

    // 3. Save student message to DB (if not empty)
    if (trimmedContent) {
      await db.insert(chatMessages).values({
        id: uuid(),
        sessionId: req.params.sessionId,
        userId,
        role: "user",
        kind: isClarificationTurn
          ? "hint_request"
          : isAnswerTurn
            ? "evaluation"
            : "learning",
        content: trimmedContent,
      });
    }

    // 4. Load full conversation history
    const history = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, req.params.sessionId))
      .orderBy(asc(chatMessages.createdAt));

    const messages: ChatMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    if (drawAttachment) {
      const lastUserIndex = [...messages]
        .reverse()
        .findIndex((message) => message.role === "user");

      if (lastUserIndex !== -1) {
        const absoluteIndex = messages.length - 1 - lastUserIndex;
        const lastUserMessage = messages[absoluteIndex];
        const textContent =
          typeof lastUserMessage.content === "string"
            ? lastUserMessage.content
            : trimmedContent;

        messages[absoluteIndex] = {
          role: "user",
          content: [
            { type: "text", text: textContent },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: drawAttachment.mediaType,
                data: drawAttachment.base64Data,
              },
            },
          ],
        };
      }
    }

    // 5. Call the tutor agent
    const response = await tutorRespond(
      node.title,
      node.desc,
      parentConceptTitle,
      messages,
      {
        userId,
        subconceptNodeId: node.id,
        conceptNodeId: node.parentId ?? node.id,
        sessionId: req.params.sessionId,
      },
    );

    // Keep a checkpoint question in every unfinished tutor turn.
    const assistantHistory = [...history]
      .reverse()
      .filter((message) => message.role === "assistant");
    const fallbackQuestion =
      assistantHistory
        .map((message) => extractQuestionFromTutorMessage(message.content))
        .find(Boolean) ?? null;
    const fallbackQuestionType =
      assistantHistory
        .map((message) => extractQuestionTypeFromTutorMessage(message.content))
        .find(Boolean) ?? null;
    const responseIsComplete = isClarificationTurn
      ? false
      : response.isComplete;
    const responseContent = isClarificationTurn
      ? stripTutorQuestionForClarification(response.content)
      : ensureTutorQuestion(
          response.content,
          fallbackQuestion,
          fallbackQuestionType,
          responseIsComplete,
        );

    // 6. Save AI response to DB
    const aiMessageId = uuid();
    await db.insert(chatMessages).values({
      id: aiMessageId,
      sessionId: req.params.sessionId,
      userId,
      role: "assistant",
      kind: isClarificationTurn ? "hint_response" : "learning",
      content: responseContent,
    });

    // 7. Persist structured chunk as a card in nodeContents
    if (!isClarificationTurn && !responseIsComplete) {
      const chunkQuestion = extractQuestionFromTutorMessage(responseContent);
      const chunkQuestionType = extractQuestionTypeFromTutorMessage(responseContent);
      const chunkExplanation = stripTutorQuestionForClarification(responseContent);

      if (chunkExplanation || chunkQuestion) {
        // Get or create active nodeContents for this subconcept
        const existingContent = await db
          .select()
          .from(nodeContents)
          .where(
            and(
              eq(nodeContents.nodeId, session.nodeId!),
              eq(nodeContents.status, "active"),
            ),
          );

        let contentRow = existingContent[0];
        if (!contentRow) {
          const contentId = uuid();
          await db.insert(nodeContents).values({
            id: contentId,
            nodeId: session.nodeId!,
            explanationMd: chunkExplanation || "",
            cards: "[]",
            status: "active",
          });
          const created = await db
            .select()
            .from(nodeContents)
            .where(eq(nodeContents.id, contentId));
          contentRow = created[0];
        }

        const existingCards: Array<{
          id: string;
          index: number;
          explanation: string;
          question: string | null;
          questionType: string | null;
        }> = contentRow.cards ? JSON.parse(contentRow.cards) : [];

        const newCard = {
          id: uuid(),
          index: existingCards.length,
          explanation: chunkExplanation || "",
          question: chunkQuestion,
          questionType: chunkQuestionType,
        };

        if (response.chunkTransition === "same" && existingCards.length > 0) {
          // Re-ask scenario: update the last card
          existingCards[existingCards.length - 1] = {
            ...existingCards[existingCards.length - 1],
            explanation: chunkExplanation || existingCards[existingCards.length - 1].explanation,
            question: chunkQuestion ?? existingCards[existingCards.length - 1].question,
            questionType: chunkQuestionType ?? existingCards[existingCards.length - 1].questionType,
          };
        } else {
          existingCards.push(newCard);
        }

        await db
          .update(nodeContents)
          .set({ cards: JSON.stringify(existingCards) })
          .where(eq(nodeContents.id, contentRow.id));
      }
    }

    // 8. If complete, end the session
    if (responseIsComplete) {
      await db
        .update(chatSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(chatSessions.id, req.params.sessionId));
    }

    res.json({
      message: responseContent,
      isComplete: responseIsComplete,
      toolsUsed: response.toolsUsed,
      reasoning: response.reasoning,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
