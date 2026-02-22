# Sprout Agent Architecture

## Overview

Sprout uses autonomous AI agents that observe student data, reason about it, act on the learning graph, and verify their own changes. All agents run through a shared **agent loop** that handles multi-turn tool calling, retry logic, and reasoning visibility via callbacks.

---

## Agent Loop (`src/agents/agent-loop.ts`)

The foundation for all agents. Sends messages to Claude, executes tool calls, feeds results back, and loops until the model stops calling tools or hits `maxIterations`.

**Loop flow:**

```
Initial message → Claude → [text + tool_use blocks]
                              ↓
                    emit onThinking(text)
                    execute each tool
                    emit onToolCall / onToolResult
                              ↓
                    feed tool_results back → Claude → ...
                              ↓
                    stop_reason="end_turn" → return finalText + toolCalls
```

**Key features:**
- **Reasoning visibility**: `onThinking` callback captures Claude's reasoning text between tool calls, streamed as `agent_reasoning` SSE events
- **Retry with backoff**: 429 rate limits retried with exponential backoff (2s, 4s, 8s)
- **Configurable iterations**: Default 15, tutor uses 5

---

## Agents

### 1. Topic Agent (`src/agents/topic-agent.ts`)

**Purpose**: Design a learning path of concepts for a topic.

**Tools:**
| Tool | Description |
|------|-------------|
| `extract_all_concept_contexts` | Batch-extract relevant document sections for all concepts |
| `save_concept` | Create a concept node in the DB |
| `save_concept_edge` | Create a dependency edge between concepts |

**Flow**: Decides on concept sequence → extracts document context → saves concepts in order → creates edges.

**Small mode**: Generates 1-2 concepts instead of 6-10.

---

### 2. Subconcept Bootstrap Agent (`src/agents/subconcept-bootstrap-agent.ts`)

**Purpose**: Build the learning structure for a single concept — diagnostic questions + subconcept DAG.

**Tools:**
| Tool | Description |
|------|-------------|
| `save_diagnostic_question` | Create a diagnostic question (mcq or open_ended) |
| `save_subconcept` | Create a subconcept node |
| `save_subconcept_edge` | Create a dependency edge between subconcepts |

**Flow**: Creates diagnostic questions (mixed difficulty/format) → creates subconcepts → wires dependency edges as a DAG.

**Small mode**: 2-3 questions + 2-3 subconcepts instead of 5-10 / 8-12.

---

### 3. Concept Refinement Agent (`src/agents/concept-agent.ts`)

**Purpose**: Personalize the subconcept graph after a student answers diagnostic questions. **This is the star feature** — it follows an Observe-Reason-Act-Verify loop.

**Tools:**
| Tool | Description |
|------|-------------|
| `grade_student_answers` | Grade diagnostic answers via a grading sub-agent |
| `get_current_subconcepts` | View existing subconcept graph |
| `check_student_history` | Cross-concept performance (mastery scores, completed nodes, overall level) |
| `add_subconcept` | Add a bridge/remedial subconcept for knowledge gaps |
| `remove_subconcept` | Remove a mastered subconcept (reconnects edges) |
| `add_prerequisite_concept` | Insert a concept BEFORE current in the topic path |
| `add_followup_concept` | Insert a concept AFTER current for reinforcement/enrichment |
| `validate_graph` | Check for orphans, broken edges, unreachable nodes via BFS |

**Flow (Observe-Reason-Act-Verify):**
1. **GRADE** — Call `grade_student_answers`
2. **OBSERVE** — Call `get_current_subconcepts` + `check_student_history`
3. **REASON** — Analyze gaps, misconceptions, mastery patterns
4. **ACT** — Add/remove subconcepts, insert prerequisite/follow-up concepts
5. **VERIFY** — Call `validate_graph`, fix any issues
6. **VERIFY AGAIN** — Confirm graph is clean

---

### 4. Tutor Agent (`src/agents/tutor-chat.ts`)

**Purpose**: Teach a subconcept interactively, chunk-by-chunk, with exercises and mastery tracking.

**Tools:**
| Tool | Description |
|------|-------------|
| `check_student_progress` | Load diagnostic results for the parent concept |
| `check_prerequisite_mastery` | Check if prerequisite subconcepts are mastered |
| `generate_example` | Create a worked example for illustration |
| `create_exercise` | Create a practice problem for the student |
| `visualize_concept` | Create an ASCII/text diagram |
| `record_exercise_result` | Persist exercise attempt + update mastery score |

**Flow:**
1. Before teaching: check diagnostic results + prerequisite mastery
2. Break subconcept into 3-6 chunks
3. For each chunk: explain → ask question → evaluate answer
4. After exercises: call `record_exercise_result` to persist and check if student should move on
5. Mark `[COMPLETE]` when all chunks are covered

**Returns**: `TutorResponse` with `content`, `isComplete`, `toolsUsed`, and `reasoning` steps.

---

## Supporting Agents

| Agent | File | Purpose |
|-------|------|---------|
| Grade Answers | `grade-answers.ts` | Grade diagnostic answers (correctness, score 0-1, feedback) |
| Generate Diagnostic | `generate-diagnostic.ts` | Create 5-10 diagnostic questions for a concept |
| Review Learning Path | `review-learning-path.ts` | Post-completion review — decide if enrichment nodes are needed |

---

## Orchestration (Routes)

### `POST /api/agents/topics/:topicNodeId/run`

Two-phase pipeline via SSE:
1. **Topic Agent** generates concepts (streamed)
2. **Subconcept Bootstrap Agents** run in parallel (capped at 3 concurrent) for each concept

Pass `{ "small": true }` in the request body for cheap testing (1-2 concepts, 2-3 subconcepts).

### `POST /api/agents/concepts/:conceptNodeId/run`

Two-phase response:
- **Phase 1** (no answers yet): Returns diagnostic questions as JSON
- **Phase 2** (answers exist): Streams concept refinement agent via SSE

### `POST /api/chat/sessions/:sessionId/tutor`

Interactive tutoring — sends student message, returns AI tutor response with reasoning. Passes full student context (userId, nodeIds, sessionId) so the tutor can query the DB.

### `POST /api/agents/nodes/:nodeId/review`

Post-completion path enrichment — decides whether to insert additional concepts/subconcepts.

---

## SSE Events

All streaming endpoints use the SSE writer (`src/utils/sse.ts`) with agent tracking (auto-closes when all agents resolve).

| Event | Data | Description |
|-------|------|-------------|
| `agent_start` | `{ agent }` | Agent has started |
| `agent_reasoning` | `{ agent, text }` | Claude's reasoning between tool calls |
| `tool_call` | `{ tool, input }` | Tool invocation |
| `tool_result` | `{ tool, summary }` | Tool result (truncated to 200 chars) |
| `node_created` | `{ node }` | New node persisted to DB |
| `edge_created` | `{ edge }` | New edge persisted to DB |
| `node_removed` | `{ nodeId }` | Node deleted |
| `edge_removed` | `{ sourceNodeId, targetNodeId }` | Edge deleted |
| `agent_done` | `{ agent, ... }` | Agent completed successfully |
| `agent_error` | `{ agent, message }` | Agent failed |

---

## Data Flow: Full Topic Onboarding

```
User creates topic
        ↓
POST /topics/{id}/run
        ↓
┌─ Topic Agent ─────────────────────────────┐
│  Generates 6-10 concepts                  │
│  Extracts document context per concept    │
│  Saves nodes + edges, streams SSE         │
└───────────────────────────────────────────┘
        ↓
┌─ Subconcept Bootstrap (×N, parallel 3) ───┐
│  Creates diagnostic questions per concept │
│  Creates subconcept DAG per concept       │
│  Streams SSE for each                     │
└───────────────────────────────────────────┘
        ↓
User answers diagnostic questions
        ↓
POST /concepts/{id}/run
        ↓
┌─ Concept Refinement Agent ────────────────┐
│  1. GRADE diagnostic answers              │
│  2. OBSERVE subconcepts + student history │
│  3. REASON about gaps & mastery           │
│  4. ACT: add/remove subconcepts           │
│  5. VERIFY graph integrity                │
│  6. VERIFY AGAIN after fixes              │
└───────────────────────────────────────────┘
        ↓
User learns subconcepts via tutor
        ↓
POST /chat/sessions/{id}/tutor
        ↓
┌─ Tutor Agent ─────────────────────────────┐
│  Checks progress + prerequisites          │
│  Teaches chunk-by-chunk                   │
│  Records exercise results                 │
│  Updates mastery scores                   │
│  Marks complete when done                 │
└───────────────────────────────────────────┘
```
