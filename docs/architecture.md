# Seer Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────┐
│ User Interface                                            │
├─────────────────────┬────────────────────────────────────┤
│  CLI (Bun)          │  Web UI (Next.js)                  │
│  Commander.js       │  React + Tailwind + react-markdown │
└─────────┬───────────┴──────────────┬─────────────────────┘
          │                          │
          └──────────┬───────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Shared SQLite (data/seer.db)                             │
│ Drizzle ORM — 6 tables                                   │
│ eval_sets │ eval_cases │ eval_criteria                    │
│ eval_runs │ eval_results │ eval_scores                    │
└─────────┬────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│ Eval Engine                                               │
├──────────────┬───────────────┬───────────────────────────┤
│ Agent Runner │ Smart Gen     │ Judge                      │
│ glean.ts     │ generate-     │ judge.ts                   │
│              │ agent.ts      │                            │
│ runworkflow  │ /rest/api/v1/ │ Glean Chat                 │
│ + traces     │ chat ADVANCED │ (Opus 4.6)                 │
└──────┬───────┴───────┬───────┴───────────┬───────────────┘
       │               │                   │
       ▼               ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│ Glean API (single GLEAN_API_KEY)                         │
├──────────────────────────────────────────────────────────┤
│ /rest/api/v1/runworkflow     Agent execution + traces    │
│ /rest/api/v1/chat            ADVANCED agent + judge      │
│ /rest/api/v1/agents/{id}/... Schema + info fetches       │
└──────────────────────────────────────────────────────────┘
```

## Components

### Agent Runner (`src/data/glean.ts`)

Executes Glean agents and collects responses with trace metadata.

- **Endpoint:** `POST /rest/api/v1/runworkflow`
- **Auth:** Bearer token (CHAT-scoped, unified `GLEAN_API_KEY`)
- **Payload format:** `{ workflowId, fields/messages, stream: false, enableTrace: true }`
- **Returns:** response text (CONTENT messages), traceId, tool calls, reasoning chain (UPDATE messages)
- **Schema detection:** fetches `/rest/api/v1/agents/{id}/schemas` to determine form vs chat input

Internal API differences from public API:
| Field | Public API | Internal (runworkflow) |
|-------|-----------|----------------------|
| Agent ID | `agent_id` | `workflowId` |
| Form inputs | `input` | `fields` |
| Message author | `role: "USER"` | `author: "USER"` |
| Message content | `content: [{text, type}]` | `fragments: [{text}]` |

### Smart Generator (`src/lib/generate-agent.ts`)

Generates grounded eval sets using Glean's ADVANCED toolkit agent.

- **Endpoint:** `POST /rest/api/v1/chat` with `agentConfig: { agent: "ADVANCED", toolSets: { enableCompanyTools: true } }`
- **Uses raw fetch** (SDK doesn't support ADVANCED mode yet)
- **Phase 1:** Ask agent to find realistic input values from company data (CRM, success plans)
- **Phase 2:** For each input, ask agent what a good output should look like based on available documents
- **Output:** Structured `{ input, query, evalGuidance }` cases

### Judge (`src/lib/judge.ts`)

Scores agent responses using LLM-as-judge via Glean Chat.

- Uses Glean Chat API with `modelSetId: "OPUS_4_6_VERTEX"` for Opus 4.6
- Supports continuous (0-10), categorical, and binary scoring
- Chain-of-thought reasoning before score (REASONING → SCORE format)
- Currently uses Glean SDK `client.chat.create()`

### Config (`src/lib/config.ts`)

- **Priority:** `data/settings.json` → `.env` → error
- **Single key:** `GLEAN_API_KEY` (chat + search + agents scopes)
- **Legacy fallback:** `GLEAN_CHAT_API_KEY`, `GLEAN_AGENT_API_KEY`
- **Settings UI:** Web page at `/settings` reads/writes `data/settings.json`

## Database Schema

```sql
eval_sets        -- Named collections of test cases for an agent
eval_cases       -- Individual test inputs with optional expected answers
eval_criteria    -- Scoring dimensions with rubrics and score types
eval_runs        -- Execution metadata (timestamps, judge config, status)
eval_results     -- Agent responses, latency, tool calls per case
eval_scores      -- Individual scores per criterion per result
```

## Data Flow

### Eval Run
```
1. CLI: seer run <set-id> --criteria task_success,factuality
2. Load eval set + cases from SQLite
3. For each case:
   a. runAgent() → POST /rest/api/v1/runworkflow → response + traces
   b. judgeResponse() → POST /rest/api/v1/chat → score + reasoning
   c. Save result + scores to SQLite
4. Display summary (overall score, per-criterion breakdown)
```

### Eval Generation
```
1. CLI: seer generate <agent-id> --count 5
2. Fetch agent schema + description
3. askAgent("find 5 real values for account name") → ADVANCED + company tools
4. For each candidate:
   askAgent("what should a good response look like?") → grounded expected output
5. Preview → user approves → save to SQLite
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | All CLI commands (Commander.js) |
| `src/data/glean.ts` | Agent execution via runworkflow |
| `src/lib/generate-agent.ts` | Smart generation (ADVANCED agent) |
| `src/lib/generate.ts` | Legacy generation (Glean Chat SDK) |
| `src/lib/judge.ts` | LLM-as-judge scoring |
| `src/lib/config.ts` | Config loader (settings.json + .env) |
| `src/lib/fetch-agent.ts` | Agent info fetcher |
| `src/lib/metrics.ts` | Direct metric extraction |
| `src/db/schema.ts` | Drizzle schema definitions |
| `src/criteria/defaults.ts` | 10 default scoring criteria |
| `web/lib/db.ts` | Shared SQLite access for web |
