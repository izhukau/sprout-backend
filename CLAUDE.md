# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sprout is an adaptive learning platform backend. It uses autonomous AI agents (powered by Claude) to generate personalized learning paths: topics → concepts → subconcepts, with diagnostic assessments and interactive tutoring. The backend is an Express API with SQLite (via Drizzle ORM) and streams agent activity to the frontend via SSE.

## Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch), port 8000
npm run build        # TypeScript compile to dist/
npm start            # Run compiled output (node dist/index.js)
npm run db:generate  # Generate Drizzle migration files from schema changes
npm run db:migrate   # Apply pending migrations (tsx src/db/migrate.ts)
npm run db:push      # Push schema directly to DB (dev shortcut, no migration files)
```

## Tech Stack

- **Runtime**: Node.js with TypeScript (CommonJS, ES2022 target)
- **Framework**: Express 5
- **Database**: SQLite via better-sqlite3 + Drizzle ORM (WAL mode, foreign keys ON)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) — all agents use Claude
- **File Storage**: AWS S3 for document uploads, pdf-parse for text extraction
- **Validation**: Zod
- **Dev**: tsx for running TS directly

## Architecture

### Data Model (src/db/schema.ts)

Three-level node hierarchy: **root** (topic) → **concept** → **subconcept**, stored in the `nodes` table with `type` and `parentId`. Dependencies between same-level nodes are expressed as directed edges in `nodeEdges` (forming a DAG).

Key tables: `users`, `branches`, `nodes`, `nodeEdges`, `topicDocuments`, `nodeContents`, `assessments`, `questions`, `answers`, `userNodeProgress`, `chatSessions`, `chatMessages`, `hintEvents`.

### Agent System (src/agents/)

All agents run through `agent-loop.ts` — a multi-turn tool-calling loop that sends messages to Claude, executes tool calls, feeds results back, and repeats until done or `maxIterations` (default 15). Includes 429 retry with exponential backoff and reasoning visibility via `onThinking` callback.

Each agent defines its own tools (as `AgentTool[]`) and system prompt. See `AGENTS.md` for full agent documentation including tools, flows, and orchestration details.

**Core agents:**
- `topic-agent.ts` — designs concept sequence for a topic, extracts document context
- `subconcept-bootstrap-agent.ts` — builds diagnostic questions + subconcept DAG per concept
- `concept-agent.ts` — personalizes subconcept graph after student answers diagnostics (Observe-Reason-Act-Verify loop)
- `tutor-chat.ts` — interactive teaching with exercises and mastery tracking

**Supporting agents:** `grade-answers.ts`, `generate-diagnostic.ts`, `review-learning-path.ts`

### SSE Streaming (src/utils/sse.ts)

Agent endpoints stream progress via SSE using a queue-based writer with agent tracking (auto-closes when all registered agents resolve). Events include: `agent_start`, `agent_reasoning`, `tool_call`, `tool_result`, `node_created`, `edge_created`, `node_removed`, `agent_done`, `agent_error`.

### Routes (src/routes/)

- `agents.ts` — agent orchestration endpoints (topic run, concept run, node review)
- `chat.ts` — chat sessions and tutor interactions
- `nodes.ts`, `node-contents.ts`, `documents.ts` — CRUD for learning graph
- `assessments.ts`, `progress.ts` — diagnostic questions and student progress
- `users.ts`, `branches.ts` — user and branch management

All routes are mounted under `/api/` prefix. Health check at `GET /api/health`.

## Environment Variables

Requires `.env` with: `ANTHROPIC_API_KEY`, AWS credentials for S3 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`). Optional: `DB_PATH` (defaults to `./sprout.db`), `PORT` (defaults to 8000).

## Database Conventions

- All IDs are UUIDs (text primary key), generated with `uuid` package
- Timestamps are text columns with SQLite `datetime('now')` defaults
- JSON data stored as text columns (options, grading rubrics, response metadata) — parse with `JSON.parse()`
- Migrations live in `drizzle/` directory, schema defined in `src/db/schema.ts`
