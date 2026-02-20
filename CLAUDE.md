# Seer: Agent Evaluation Framework

**Purpose:** Systematic evaluation of Glean agents using method-aware LLM-as-judge scoring.

## What This Is

Seer evaluates AI agents built in Glean's Agent Builder:
- **Three-call judge architecture** — coverage (reference-based), faithfulness (reference-free), factuality (search-verified)
- **Categorical scoring** — full/substantial/partial/minimal/failure (15% more reliable than 0-10 scales, per SJT research)
- **Multi-judge ensemble** — Opus 4.6, GPT-5, Gemini with majority vote aggregation
- **Smart eval generation** — ADVANCED toolkit agent with company search finds real inputs from CRM/docs
- **Full execution traces** — trace IDs, tool calls, reasoning chains from runworkflow
- **Shared architecture** — CLI and Web UI read/write the same SQLite database
- **Glean-branded UI** — DM Sans/Mono, Electric Blue, oatmeal backgrounds, research-backed tooltips

## Architecture

```
User Interface
├── CLI (Commander.js + Bun)
└── Web UI (Next.js + Tailwind + DM Sans)
    ↓
Shared SQLite (Drizzle ORM — 6 tables)
    ↓
Eval Engine
├── Agent Runner       POST /rest/api/v1/runworkflow
│   └── Returns: response, traceId, toolCalls, reasoningChain
├── Smart Generator    POST /rest/api/v1/chat (ADVANCED + company tools)
│   └── Finds real inputs, generates grounded eval guidance
├── Judge              POST /rest/api/v1/chat (Opus 4.6 via modelSetId)
│   ├── Call 1: Coverage    — reference-based, scores against eval guidance
│   ├── Call 2: Faithfulness — source-grounded, reads agent's source docs via search
│   └── Call 3: Factuality  — search-verified, ADVANCED agent verifies claims broadly
└── Metrics            Latency (client-side), tool call count
```

## API Integration

**Single API key** (`GLEAN_API_KEY`) with chat + search + agents scopes.

| Endpoint | Purpose |
|----------|---------|
| `/rest/api/v1/runworkflow` | Agent execution with trace metadata |
| `/rest/api/v1/chat` | Judge calls (modelSetId: OPUS_4_6_VERTEX / GPT_5 / ADVANCED) |
| `/rest/api/v1/chat` + ADVANCED | Smart generation + factuality verification |
| `/rest/api/v1/agents/{id}/schemas` | Schema fetch (form vs chat detection) |
| `/rest/api/v1/agents/{id}` | Agent name + description |

**Payload notes:** `runworkflow` uses `workflowId` (not `agent_id`), `fields` (not `input`), `author`/`fragments` (not `role`/`content`), `enableTrace: true`.

**Token counts** not available via REST API (FR-2147). See `docs/TRACE_API_LIMITATIONS.md`.

## Evaluation Dimensions

7 dimensions organized by judge call type:

| Dimension | Type | Judge Call | Reference | Tools |
|-----------|------|-----------|-----------|-------|
| Topical Coverage | Categorical | Coverage | Eval guidance (themes) | None |
| Response Quality | Categorical | Coverage | Eval guidance | None |
| Groundedness | Categorical | Faithfulness | Agent's source documents | Company search (reads docs) |
| Hallucination Risk | Categorical | Faithfulness | Agent's source documents | Company search (reads docs) |
| Factual Accuracy | Categorical | Factuality | Live company search | Company search (broad) |
| Latency | Metric | Direct | Client timer | None |
| Tool Calls | Metric | Direct | Execution data | None |

Quality scale: `full` (10) → `substantial` (7.5) → `partial` (5) → `minimal` (2.5) → `failure` (0)
Hallucination scale: `low` (10) → `medium` (5) → `high` (0)

## File Organization

```
src/
├── cli.ts                  # CLI commands (run, generate, results, list, set)
├── types.ts                # Core domain types (AgentResult, JudgeScore, etc.)
├── db/
│   ├── schema.ts           # Drizzle SQLite schema (6 tables)
│   ├── index.ts            # DB connection + initialization
│   └── seed.ts             # Default criteria seeding
├── data/
│   └── glean.ts            # Agent runner (runworkflow + trace extraction)
├── lib/
│   ├── config.ts           # Config: settings.json → .env → error
│   ├── generate-agent.ts   # Smart generation (ADVANCED agent + company tools)
│   ├── generate.ts         # Legacy generation (Glean Chat SDK, unused)
│   ├── fetch-agent.ts      # Agent info fetcher
│   ├── judge.ts            # Three-call judge with multi-model ensemble
│   ├── metrics.ts          # Direct metric extraction
│   └── id.ts               # ID generation (nanoid)
├── criteria/
│   └── defaults.ts         # 7 dimension definitions with categorical rubrics
web/
├── app/                    # Next.js pages (dashboard, sets, runs, settings)
├── components/             # UI (ResultsTable, CaseTable, EvalConfigSection, JudgeMethodology, RunProgress, Tooltip)
├── lib/dimensions.ts       # Shared dimension definitions (tooltips, context, descriptions)
├── lib/db.ts               # Shared SQLite access
docs/
├── evaluation-framework.md # Core eval philosophy and dimension design
├── architecture.md         # System architecture and data flow
├── features.md             # Feature tracking and roadmap
├── resources.md            # Research references and API docs
├── issues.md               # Bug tracking and known limitations
├── frontend-design-spec.md # Glean-branded UI design spec
├── ai-api-calls.md         # Every AI API call mapped (endpoints, prompts, models)
├── TRACE_API_LIMITATIONS.md
├── guide-petri-judge-patterns.md
├── guide-judge-best-practices.md
├── guide-qa-judge-prompts.md
├── research-dynamic-eval.md
```

## Key Design Decisions

1. **Categorical over continuous** — SJT research shows 15% reliability gain (Cavanagh, 2026)
2. **Three separate judge calls** — each dimension needs different reference material (eval guidance vs reasoning chain vs live search)
3. **Source-grounded faithfulness** — immune to data staleness; reads agent's actual source documents via search tools to verify claims
4. **Raw fetch over SDK** — SDK doesn't support ADVANCED agent mode or modelSetId; raw fetch bypasses Zod validation
5. **CONTENT vs UPDATE messages** — Final answers are `messageType: "CONTENT"`, reasoning is `messageType: "UPDATE"`
6. **Multi-judge with majority vote** — cross-family panels reduce model-specific biases (Verga et al., 2024)
7. **Eval guidance, not expected answers** — themes are stable over time even as facts change (FreshQA, Vu et al., 2023)

## Usage

```bash
# Generate eval set (finds real inputs from company data)
bun run src/cli.ts generate <agent-id> --count 5

# Quick eval (coverage + faithfulness, 2 judge calls/case)
bun run src/cli.ts run <set-id>

# Deep eval (+ factuality verification with company search)
bun run src/cli.ts run <set-id> --deep

# Multi-judge (Opus 4.6 + GPT-5)
bun run src/cli.ts run <set-id> --multi-judge

# View results
bun run src/cli.ts results <run-id>

# Web UI
cd web && bun run dev
```

## Research Foundation

| Source | What we adopted |
|--------|----------------|
| Cavanagh (2026) — LLM-as-Judge | Categorical scales, multi-judge panels, narrative-score decoupling awareness |
| RAGAS (Shahul et al., 2023) | Faithfulness via claim decomposition against retrieved context |
| G-Eval (Liu et al., 2023) | CoT-then-score (10-20% human correlation improvement) |
| GER-Eval (Siro et al., 2025) | Judge unreliability in knowledge domains → search-verified factuality |
| FreshQA (Vu et al., 2023) | Temporal volatility → eval guidance as themes, not exact answers |
| Rubric RL (Wolfe, 2025) | Instance-specific rubrics (planned), implicit aggregation |
| Verga et al. (2024) | Cross-family judge panels, ensemble reliability |

-- Axon | 2026-02-18
