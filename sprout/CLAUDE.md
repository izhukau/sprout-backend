# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sprout is an AI-powered adaptive learning platform. Built with Next.js 16 (App Router), React 19, TypeScript, React Flow (`@xyflow/react`), and react-force-graph-3d (with d3-force for branch clustering). Node layout is computed by Dagre (`@dagrejs/dagre`).

### Product Vision

**Input:** Text, file uploads, or voice (ElevenLabs) to define what to learn.

**Graph hierarchy (3 levels):**
1. **Global graph** — A mind map of all knowledge across projects. If a topic was studied in a previous pathway, nodes connect across projects.
2. **Linear pathway** — A linear branch of high-level topic nodes forming the study path (generated from learning objectives, can integrate professor-assigned tasks).
3. **Subgraph per node** — Each pathway node expands into a non-linear subgraph where each node has:
   - **Learn:** Flashcards / text content
   - **Practice/Test:** AI-chosen format — handwritten (Miro), code, text explanation. Includes a Hint button that sends context to chat.
   - **Recap:** Spaced-repetition checkpoints; must complete recap to unlock the next node.

**Edges** represent health/progress toward the next node. Node accuracy is shown via color shading and on hover.

**Dynamic graph generation:** The linear pathway (concepts) is generated upfront by AI from the topic. Subconcepts within each node are generated dynamically when the user first enters that node — not ahead of time. Before starting a topic, the user takes a baseline assessment (background selection + questions) to calibrate difficulty. Each subconcept node contains: 1 dense paragraph with all info + visualizations if needed, followed by active recall questions (MCQs or open-ended). Hints are personalized — the LLM references previous successful interactions with the user to frame hints effectively.

**Data model:** Topics → Concepts → Subconcepts.

**Multi-agent architecture:** A voice agent (ElevenLabs) talks with the user sharing a transcript as common knowledge, while a graph agent updates graphs in real time — both agents communicate concurrently.

**Engagement metrics:** Time, voice data (pauses etc.), graph progress rate, test/recap success rate, base knowledge level, hint usage.

**Predictive features:** Approximate exam score, career progression timeline, adaptive study pathway.

**Business model:** B2B (universities/companies/schools upload internal docs) + B2C (individual learners, student discounts).

## Commands

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # Lint with Biome
npm run format    # Format with Biome (auto-write)
```

No test runner is configured yet.

## Architecture

### Routes

- `/` — Default Next.js starter (untouched)
- `/graph` — Main graph visualization (active development)
- `/login` — Login page (glassmorphism UI, green #2EE84A accent)
- `/register` — Registration page

### Authentication

- `src/contexts/auth-context.tsx` — AuthContext provider (login/register/logout via `/api/auth/*`)
- `src/hooks/use-auth.ts` — Consumer hook with context validation
- `src/proxy.ts` — Next.js middleware for route protection. Checks `access_token` cookie; redirects authenticated users away from auth pages to `/graph`. `PROTECTED_ROUTES` is currently empty (no routes gated yet).

### Graph data flow

```
mockNodes + mockBranches (lib/mock-data.ts)
    ↓
lib/graph-utils.ts — Utility functions:
  buildBranchColorMap()        — Golden-angle hue spacing for branch colors
  buildEdgesFromNodes()        — Build edges from parent relationships
  getConceptNodesForBranch()   — Filter concepts for a branch
  getSubconceptNodesForConcept() — Get subconcepts for a concept
  toForceGraphData()           — Convert to react-force-graph-3d format
    ↓
GraphViewContainer (graph-view.tsx) — Orchestrator managing view level, highlighted branch, expanded/focused node
  ├── ForceGraphView (force-graph-view.tsx) — 3D force-directed graph (global level) using react-force-graph-3d + d3-force
  ├── GraphCanvas (graph-canvas.tsx)        — 2D React Flow canvas (branch/concept levels) with Dagre layout (TB, 280×52)
  ├── GraphNode (graph-node.tsx)            — Custom node with 3 variants: root (Globe), concept (BookOpen), subconcept (Layers). Concept nodes expand inline with summary + "Open Subconcepts" button.
  └── GraphSidebar (graph-sidebar.tsx)      — Three-level navigation: branches → concepts → subconcepts
```

**Three view levels:** global (3D force graph with branch clustering) → branch (2D linear concept chain) → concept (2D non-linear subconcept subgraph).

**Frontier detection:** Edges from completed → incomplete nodes are marked "frontier" (animated). Frontier nodes have ambient glow.

Graph data is currently hardcoded mock data in `lib/mock-data.ts` (3 branches, 9 concepts, 36 subconcepts, 1 root = 46 nodes). No backend or data-fetching layer exists yet.

## Key Conventions

- **Styling:** Tailwind CSS v4 (PostCSS plugin mode) + shadcn/ui (new-york style, neutral base, oklch color tokens in `globals.css`)
- **Linting/Formatting:** Biome 2 (not ESLint/Prettier). 2-space indent.
- **Path alias:** `@/*` maps to `./src/*`
- **React Compiler** is enabled (`reactCompiler: true` in next.config.ts)
- **Icons:** lucide-react
- Component variants use `class-variance-authority` (cva)
- `cn()` helper in `lib/utils.ts` combines clsx + tailwind-merge
