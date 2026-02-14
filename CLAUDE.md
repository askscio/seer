# Seer: Agent Evaluation Framework

**Purpose:** Systematic evaluation of Glean agents using LLM-as-judge methodology.

## What This Is

Seer evaluates AI agents built in Glean's Agent Builder through:
- **LLM-as-judge scoring** across multiple dimensions (task success, factuality, relevance)
- **Smart eval generation** using Glean's ADVANCED toolkit agent with company search
- **Full execution traces** — trace IDs, tool calls, reasoning chains from runworkflow
- **Shared architecture** — CLI and Web UI read/write the same SQLite database

## Architecture

```
User Interface
├── CLI (Commander.js + Bun)
└── Web UI (Next.js + Tailwind)
    ↓
Shared SQLite (Drizzle ORM)
    ↓
Eval Engine
├── Agent Runner       POST /rest/api/v1/runworkflow (CHAT-scoped key)
│   └── Returns: response, traceId, toolCalls, reasoningChain
├── Smart Generator    POST /rest/api/v1/chat (ADVANCED agent + company tools)
│   └── Finds real inputs from CRM, generates grounded expected outputs
├── Judge              Glean Chat API (LLM-as-judge via Glean)
└── Metrics            Latency (client-side), tool call count
```

## API Integration

**Single API key** (`GLEAN_API_KEY`) with chat + search + agents scopes.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/rest/api/v1/runworkflow` | Bearer (CHAT scope) | Agent execution + trace metadata |
| `/rest/api/v1/chat` | Bearer (CHAT scope) | Judge calls + smart generation (ADVANCED agent) |
| `/rest/api/v1/agents/{id}/schemas` | Bearer | Schema fetch for form/chat detection |
| `/rest/api/v1/agents/{id}` | Bearer | Agent name + description |

**Internal API note:** `/rest/api/v1/runworkflow` uses `workflowId` (not `agent_id`), `fields` (not `input`), `author`/`fragments` (not `role`/`content`), and `enableTrace: true`.

**Token counts** not available via REST API. See `docs/TRACE_API_LIMITATIONS.md`.

## File Organization

```
src/
├── cli.ts                  # Commander.js commands
├── types.ts                # Core domain types
├── db/
│   ├── schema.ts           # Drizzle SQLite schema (6 tables)
│   ├── index.ts            # DB connection + initialization
│   └── seed.ts             # Default criteria seeding
├── data/
│   └── glean.ts            # Agent runner (runworkflow + trace extraction)
├── lib/
│   ├── config.ts           # Config: settings.json → .env → error
│   ├── generate-agent.ts   # Smart generation (ADVANCED agent + company tools)
│   ├── generate.ts         # Legacy generation (Glean Chat SDK)
│   ├── fetch-agent.ts      # Agent info fetcher
│   ├── judge.ts            # LLM-as-judge (Glean Chat)
│   ├── metrics.ts          # Direct metric extraction
│   └── id.ts               # ID generation (nanoid)
├── criteria/
│   └── defaults.ts         # 10 default criteria definitions
web/
├── app/                    # Next.js pages (dashboard, sets, runs, settings)
├── components/             # UI components (ResultsTable, CaseTable, Markdown)
├── lib/db.ts               # Shared SQLite access
docs/
├── architecture.md
├── features.md
├── issues.md
├── resources.md
├── TRACE_API_LIMITATIONS.md
```

## Key Design Decisions

1. **Single API key** — Unified key replaces old split (agent key + chat key)
2. **Raw fetch over SDK** — SDK doesn't support ADVANCED agent mode yet; raw fetch bypasses Zod validation
3. **CONTENT vs UPDATE messages** — Final answers are `messageType: "CONTENT"`, intermediate reasoning is `messageType: "UPDATE"`
4. **Schema caching** — Agent schemas cached per-run to avoid redundant API calls
5. **Settings.json** — `data/settings.json` for config, with `.env` fallback. Settings UI at `/settings`

## Usage

```bash
# Generate eval set (smart — searches company data for real inputs)
bun run src/cli.ts generate <agent-id> --count 5

# Run evaluation
bun run src/cli.ts run <set-id> --criteria task_success,factuality,relevance

# View results
bun run src/cli.ts results <run-id>

# Web UI
cd web && bun run dev  # http://localhost:3000
```

-- Axon | 2026-02-13
