# Seer: Agent Evaluation Framework

**Purpose:** Systematic evaluation of Glean agents using LLM-as-judge methodology with research-backed best practices.

## What This Is

Seer evaluates AI agents through:
- **Multiple scoring types:** Binary, categorical, continuous (0-10), and direct metrics
- **LLM-as-judge:** Uses Claude/GPT to score responses against defined criteria
- **Optional ensembles:** Multi-judge consensus with confidence intervals
- **Full tracking:** SQLite persistence of all eval sets, runs, and results

## Architecture

```
CLI (Commander.js)
    ↓
DB Layer (Drizzle + SQLite)
    ↓
Eval Engine
    ├── Agent Runner (Glean API)
    ├── Judge (Anthropic/OpenAI)
    └── Metrics (latency, tokens, tool calls)
```

## Core Concepts

**Eval Set:** Collection of test cases for an agent (queries + optional expected answers)
**Criterion:** Scoring dimension with rubric (e.g., task_success, factuality)
**Run:** Execution of eval set → generates results
**Score:** Judge's assessment for one criterion on one case

## Scoring Types

1. **Continuous (0-10):** Nuanced quality assessment (task success, factuality, relevance)
2. **Categorical:** Clear tiers (complete/partial/incomplete)
3. **Binary:** Yes/no decisions (safe_output, uses_correct_tools)
4. **Metrics:** Direct measurement (latency, tokens, tool call count)

## Research Foundation

Based on:
- Academic LLM-as-judge best practices (arxiv papers on RRD framework, bias mitigation)
- Glean internal evaluation practices
- Anthropic Petri 2.0 methodology
- I/O psychology lens (behavioral validation, categorical reliability)

## Development Notes

- **SQLite from day 1:** No throwaway JSON files, proper persistence from start
- **All score types in v1:** Complete measurement system immediately
- **CLI-first:** Simple commands, not TUI - easy to run, easy to extend
- **Progressive enhancement:** Each phase adds value independently
- **Multi-judge optional:** Don't force cost on every eval

## File Organization

```
src/
├── cli.ts              # Commander.js commands
├── types.ts            # Core domain types
├── db/
│   ├── schema.ts       # Drizzle SQLite schema
│   ├── index.ts        # DB connection & queries
│   └── seed.ts         # Default criteria seeding
├── data/
│   └── glean.ts        # Glean Agent API client
├── lib/
│   ├── config.ts       # Load .env
│   ├── judge.ts        # LLM-as-judge (all score types)
│   ├── ensemble.ts     # Multi-judge orchestration
│   ├── reliability.ts  # Confidence intervals, agreement
│   └── metrics.ts      # Metric extraction
└── criteria/
    └── defaults.ts     # Default criteria definitions
```

## Build Phases

- **Phase 0:** Project setup ✓
- **Phase 1:** MVP - CLI + SQLite + All score types (4-5h)
- **Phase 2:** Multi-judge ensemble (3-4h)
- **Phase 3:** Web UI (Next.js) (4-5h)
- **Phase 4:** Advanced features (future)

## Usage Pattern

```bash
# Create eval set
seer set create --name "Support Agent" --agent-id abc123

# Add test cases
seer set add-case <set-id> --query "How do I reset password?"

# Run evaluation
seer run <set-id> --criteria task_success,factuality

# View results
seer results <run-id>
```

## Key Design Decisions

1. **Why SQLite?** Full relational model, historical tracking, easy querying, no external DB
2. **Why all score types at once?** Different dimensions need different scales - build complete system immediately
3. **Why CLI-first?** Agents and technical users prefer terminal, web is progressive enhancement
4. **Why optional ensembles?** Cost vs. reliability tradeoff should be per-eval decision

-- Axon | 2026-02-12
