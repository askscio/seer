# Seer

**Agent evaluation framework for Glean agents using LLM-as-judge methodology**

Seer evaluates AI agents built in Glean's Agent Builder. It runs agents, scores their responses across multiple dimensions using a research-backed judge architecture, and tracks results over time.

## Setup

```bash
bun install

cp .env.example .env
# Add your GLEAN_API_KEY (needs chat + search + agents scopes)

# Initialize the database (runs automatically on first CLI command)
bun run src/cli.ts list sets
```

### Web UI

```bash
cd web && bun install && bun run dev
```

## Quick Start

### 1. Generate an eval set

```bash
bun run src/cli.ts generate <agent-id> --count 5
```

Uses Glean's ADVANCED agent with company search to find real input values from your CRM/documents and generate grounded evaluation guidance.

### 2. Run evaluation

```bash
# Quick mode (coverage + faithfulness, 2 judge calls/case)
bun run src/cli.ts run <set-id>

# Deep mode (+ factuality verification via company search)
bun run src/cli.ts run <set-id> --deep

# Multi-judge (Opus 4.6 + GPT-5)
bun run src/cli.ts run <set-id> --multi-judge
```

### 3. View results

```bash
bun run src/cli.ts results <run-id>
```

Or use the Web UI for formatted results with markdown rendering and research-backed tooltips.

## How Scoring Works

Three judge calls, each measuring something different:

| Call | Dimensions | What it checks against | Needs expected answer? |
|------|-----------|----------------------|----------------------|
| **Coverage** | Topical Coverage, Response Quality | Eval guidance (themes to cover) | Yes |
| **Faithfulness** | Groundedness, Hallucination Risk | Agent's own retrieved documents | No |
| **Factuality** | Factual Accuracy | Live company data (judge searches independently) | No |

**Categorical scale** (not 1-10): `full` → `substantial` → `partial` → `minimal` → `failure`

Categories are 15% more reliable than continuous scales (SJT research). The judge commits to a defined bucket instead of picking an arbitrary number.

## Configuration

### Option A: Settings UI
Open `/settings` in the web UI. Saves to `data/settings.json`.

### Option B: .env file
```bash
GLEAN_API_KEY=your_key_here
GLEAN_BACKEND=https://scio-prod-be.glean.com
GLEAN_INSTANCE=scio-prod
```

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
bun run src/cli.ts run <set-id> [--deep] [--multi-judge] [--multi-turn] [--max-turns 5]
bun run src/cli.ts results <run-id>
bun run src/cli.ts list runs
```

## Architecture

```
CLI ←→ Shared SQLite ←→ Web UI
              ↓
        Eval Engine
      ├── Agent Runner    (runworkflow for workflow agents, Chat API for autonomous)
      ├── Simulator       (LLM-based simulated user for multi-turn conversations)
      ├── Smart Generator (ADVANCED agent + company tools)
      ├── Judge           (4-call architecture, Opus 4.6)
      └── Metrics         (latency, tool calls)
```

See `docs/evaluation-framework.md` for the full evaluation philosophy and `docs/architecture.md` for system design.

## License

MIT
