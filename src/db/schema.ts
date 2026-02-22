import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// =========================
// Core entities
// =========================

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // uuid
  email: text("email").notNull().unique(),
  title: text("title"),
  desc: text("desc"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("branches_user_id_idx").on(table.userId)]
);

// node_type: 'root' | 'concept' | 'subconcept'
export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type", { enum: ["root", "concept", "subconcept"] }).notNull(),
    branchId: text("branch_id").references(() => branches.id),
    parentId: text("parent_id").references((): any => nodes.id),
    title: text("title").notNull(),
    desc: text("desc"),
    accuracyScore: real("accuracy_score").notNull().default(0), // 0..1
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("nodes_user_type_idx").on(table.userId, table.type),
    index("nodes_branch_id_idx").on(table.branchId),
    index("nodes_parent_id_idx").on(table.parentId),
  ]
);

// Documents uploaded for topic nodes (stored in S3)
export const topicDocuments = sqliteTable(
  "topic_documents",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    originalFilename: text("original_filename").notNull(),
    s3Key: text("s3_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    extractedText: text("extracted_text"),
    extractionStatus: text("extraction_status", {
      enum: ["pending", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    extractionError: text("extraction_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("topic_documents_node_id_idx").on(table.nodeId)]
);

// Dependency edges between nodes (forms a DAG / forest)
// e.g. subconcept B depends on subconcept A being learned first
export const nodeEdges = sqliteTable(
  "node_edges",
  {
    id: text("id").primaryKey(),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => nodes.id),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => nodes.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("node_edges_source_idx").on(table.sourceNodeId),
    index("node_edges_target_idx").on(table.targetNodeId),
    uniqueIndex("node_edges_source_target_idx").on(
      table.sourceNodeId,
      table.targetNodeId
    ),
  ]
);

// =======================================
// Learning pathway content & generations
// =======================================

// content_status: 'draft' | 'active' | 'archived'
export const nodeContents = sqliteTable(
  "node_contents",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    explanationMd: text("explanation_md").notNull(),
    visualizationKind: text("visualization_kind"), // 'mermaid' | 'svg' | 'json'
    visualizationPayload: text("visualization_payload"),
    cards: text("cards"), // JSON: [{ id, index, explanation, question, questionType }]
    generatedByModel: text("generated_by_model"),
    generationPromptHash: text("generation_prompt_hash"),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("node_contents_node_status_idx").on(table.nodeId, table.status),
  ]
);

// generation_trigger: 'on_first_enter' | 'manual_regenerate' | 'system_refresh'
export const nodeGenerations = sqliteTable(
  "node_generations",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    trigger: text("trigger", {
      enum: ["on_first_enter", "manual_regenerate", "system_refresh"],
    }).notNull(),
    model: text("model"),
    prompt: text("prompt"),
    responseMeta: text("response_meta"), // JSON string
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("node_generations_node_created_idx").on(
      table.nodeId,
      table.createdAt
    ),
  ]
);

// =======================================
// Pre-topic testing (diagnostic / background)
// =======================================

// assessment_type: 'diagnostic' | 'quiz' | 'recall'
export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => nodes.id),
    type: text("type", { enum: ["diagnostic", "quiz", "recall"] })
      .notNull()
      .default("diagnostic"),
    title: text("title"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("assessments_user_node_type_idx").on(
      table.userId,
      table.targetNodeId,
      table.type
    ),
  ]
);

// question_format: 'mcq' | 'open_ended'
export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id),
    nodeId: text("node_id").references(() => nodes.id),
    format: text("format", { enum: ["mcq", "open_ended"] }).notNull(),
    prompt: text("prompt").notNull(),
    options: text("options"), // JSON string
    correctAnswer: text("correct_answer"),
    gradingRubric: text("grading_rubric"), // JSON string
    difficulty: integer("difficulty").notNull().default(1), // 1..5
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("questions_assessment_id_idx").on(table.assessmentId),
    index("questions_node_id_idx").on(table.nodeId),
  ]
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    answerText: text("answer_text"),
    selectedOption: text("selected_option"),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    score: real("score"), // 0..1 or 0..100
    feedback: text("feedback"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("answers_user_assessment_idx").on(table.userId, table.assessmentId),
    index("answers_question_id_idx").on(table.questionId),
  ]
);

// =======================================
// Progress tracking
// =======================================

export const userNodeProgress = sqliteTable(
  "user_node_progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    firstEnteredAt: text("first_entered_at"),
    lastEnteredAt: text("last_entered_at"),
    completedAt: text("completed_at"),
    masteryScore: real("mastery_score").notNull().default(0), // 0..1
    attemptsCount: integer("attempts_count").notNull().default(0),
    hasGeneratedSubnodes: integer("has_generated_subnodes", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("user_node_progress_user_node_idx").on(
      table.userId,
      table.nodeId
    ),
    index("user_node_progress_node_mastery_idx").on(
      table.nodeId,
      table.masteryScore
    ),
  ]
);

// =======================================
// Chat / hinting
// =======================================

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    nodeId: text("node_id").references(() => nodes.id),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("chat_sessions_user_started_idx").on(
      table.userId,
      table.startedAt
    ),
    index("chat_sessions_node_started_idx").on(
      table.nodeId,
      table.startedAt
    ),
  ]
);

// chat_role: 'system' | 'user' | 'assistant'
// interaction_kind: 'learning' | 'hint_request' | 'hint_response' | 'evaluation'
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    kind: text("kind", {
      enum: ["learning", "hint_request", "hint_response", "evaluation"],
    })
      .notNull()
      .default("learning"),
    content: text("content").notNull(),
    wasSuccessful: integer("was_successful", { mode: "boolean" }),
    successSignal: text("success_signal"), // JSON string
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("chat_messages_session_created_idx").on(
      table.sessionId,
      table.createdAt
    ),
    index("chat_messages_user_successful_idx").on(
      table.userId,
      table.wasSuccessful
    ),
  ]
);

export const hintEvents = sqliteTable(
  "hint_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    sessionId: text("session_id").references(() => chatSessions.id),
    requestMessageId: text("request_message_id").references(
      () => chatMessages.id
    ),
    responseMessageId: text("response_message_id").references(
      () => chatMessages.id
    ),
    referencedSuccessMessageIds: text("referenced_success_message_ids"), // JSON array
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("hint_events_user_node_created_idx").on(
      table.userId,
      table.nodeId,
      table.createdAt
    ),
  ]
);
