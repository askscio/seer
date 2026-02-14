# Seer

**Agent evaluation framework for Glean agents using LLM-as-judge methodology**

Seer evaluates AI agents built in Glean's Agent Builder. It runs agents, scores their responses using LLM-as-judge, and tracks results over time. Eval sets can be generated automatically from your company's data.

## Setup

```bash
bun install

# Create .env with your Glean API key
cp .env.example .env
# Edit .env — you need a single GLEAN_API_KEY with chat + search + agents scopes

# Initialize database
bun run db:push
```

### Web UI (Optional)

```bash
cd web && bun install && bun run dev
# Open http://localhost:3000
```

## Quick Start

### 1. Generate an eval set

```bash
bun run src/cli.ts generate <agent-id> --count 5
```

This uses Glean's ADVANCED agent with company search tools to:
- Find real input values from your CRM/documents (e.g., actual account names)
- Generate expected outputs grounded in what the agent should find
- Present results for review before saving

### 2. Run evaluation

```bash
bun run src/cli.ts run <set-id> --criteria task_success,factuality,relevance
```

Each case: runs the agent → scores the response with LLM-as-judge → stores results.

### 3. View results

```bash
bun run src/cli.ts results <run-id>
```

Or open the Web UI to see formatted results with markdown rendering.

## What You Get Per Eval Run

| Metric | Source |
|--------|--------|
| Response text | Agent execution via `/rest/api/v1/runworkflow` |
| Latency | Client-side timer |
| Trace ID | `workflowTraceId` from runworkflow response |
| Tool calls | Action metadata in message fragments |
| Reasoning chain | Search queries, docs read, step flow |
| Judge scores | LLM-as-judge via Glean Chat |
| Judge reasoning | Detailed explanations per criterion |

**Known limitation:** Token counts (input/output per LLM call) are not available through the REST API. See `docs/TRACE_API_LIMITATIONS.md`.

## Scoring Criteria

| Criterion | Type | Description |
|-----------|------|-------------|
| `task_success` | Continuous (0-10) | Did the agent complete the task? |
| `factuality` | Continuous (0-10) | Is the response grounded in sources? |
| `relevance` | Continuous (0-10) | How relevant to the query? |
| `prompt_adherence` | Continuous (0-10) | Did it follow instructions? |
| `completeness` | Categorical | complete / partial / incomplete |
| `uses_correct_tools` | Binary | Did it use the right tools? |
| `safe_output` | Binary | Is the output safe? |
| `latency` | Metric | Response time (ms) |
| `tool_call_count` | Metric | Number of tool invocations |

## Commands

```bash
# Eval sets
bun run src/cli.ts set create --name <name> --agent-id <id>
bun run src/cli.ts set add-case <set-id> --query <query>
bun run src/cli.ts set view <set-id>
bun run src/cli.ts list sets

# Generate
bun run src/cli.ts generate <agent-id> --count <n>

# Run & results
bun run src/cli.ts run <set-id> --criteria <list>
bun run src/cli.ts results <run-id>
bun run src/cli.ts list runs
```

## Configuration

### Option A: Settings UI (recommended)
Open `/settings` in the web UI and enter your API key.
Saves to `data/settings.json` — shared between CLI and web.

### Option B: .env file
```bash
GLEAN_API_KEY=your_key_here  # Needs chat + search + agents scopes
GLEAN_BACKEND=https://scio-prod-be.glean.com
GLEAN_INSTANCE=scio-prod
```

## Architecture

```
CLI (Commander.js)  ←→  Shared SQLite  ←→  Web UI (Next.js)
                            ↓
                      Eval Engine
                    ├── Agent Runner    (runworkflow API)
                    ├── Smart Generator (ADVANCED agent + company tools)
                    ├── Judge           (Glean Chat LLM-as-judge)
                    └── Metrics         (latency, tool calls)
```

See `docs/architecture.md` for the full system design.

## Development

```bash
bun run db:generate  # Generate migrations
bun run db:push      # Apply schema
bun run db:studio    # Open Drizzle Studio
```

## License

MIT
