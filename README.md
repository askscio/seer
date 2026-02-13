# Seer

**Agent evaluation framework with LLM-as-judge methodology**

Seer systematically evaluates AI agents using research-backed scoring across multiple dimensions, with optional multi-judge ensembles and full historical tracking.

## Features

- **Multiple scoring types:** Binary, categorical, continuous (0-10), and direct metrics
- **Behavioral dimensions:** Task success, factuality, relevance, instruction following, completeness, safety
- **Performance metrics:** Latency, token efficiency, tool usage
- **Optional ensembles:** Multi-judge consensus with confidence intervals
- **Historical tracking:** SQLite database for all eval sets, runs, and results
- **CLI-first:** Simple commands for creating eval sets, running evaluations, viewing results

## Installation

```bash
cd lab/projects/seer
bun install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Initialize database
bun run db:generate
bun run db:push
```

## Quick Start

### 1. Create an eval set

```bash
seer set create \
  --name "Customer Support Agent" \
  --agent-id "abc123" \
  --description "Evaluating support agent quality"
```

This will prompt you to add test cases interactively.

### 2. Add more cases (optional)

```bash
seer set add-case <set-id> \
  --query "How do I reset my password?" \
  --expected "Should reference password reset documentation"
```

### 3. Run evaluation

```bash
seer run <set-id> \
  --criteria task_success,factuality,relevance \
  --judge-model claude-sonnet-4
```

### 4. View results

```bash
seer results <run-id>
```

## Scoring Types

### Continuous (0-10)
Nuanced quality assessment for dimensions like task success, factuality, relevance, and instruction following.

**Example:**
- Score 10: Fully addresses query, achieves intended outcome
- Score 7-9: Mostly complete, minor improvements possible
- Score 4-6: Partially complete, missing key elements
- Score 1-3: Barely addresses task, major gaps
- Score 0: Completely fails the task

### Categorical
Clear quality tiers for dimensions like completeness.

**Example:**
- `complete`: Addresses all aspects with appropriate depth
- `partial`: Addresses most aspects but missing details
- `incomplete`: Missing major aspects or very superficial

### Binary
Yes/no decisions for dimensions like tool usage correctness and safety.

**Example:**
- `yes` (1): Agent used appropriate tools
- `no` (0): Agent used wrong/missing tools

### Metrics
Direct measurements: latency (ms), token count, tool call count.

## Default Criteria

| Criterion | Type | Description |
|-----------|------|-------------|
| `task_success` | Continuous | Did the agent successfully complete the task? |
| `factuality` | Continuous | Is the response grounded in facts and sources? |
| `relevance` | Continuous | How relevant is the response to the query? |
| `prompt_adherence` | Continuous | Did the agent follow the instructions? |
| `completeness` | Categorical | Did the response cover all necessary aspects? |
| `uses_correct_tools` | Binary | Did the agent use appropriate tools? |
| `safe_output` | Binary | Is the output safe and appropriate? |
| `latency` | Metric | Response time in milliseconds |
| `token_efficiency` | Metric | Total tokens used |
| `tool_call_count` | Metric | Number of tool invocations |

## Advanced: Multi-Judge Ensemble

Run evaluations with multiple judges for higher reliability:

```bash
seer run <set-id> \
  --criteria task_success,factuality \
  --judge-model claude-sonnet-4 \
  --ensemble gpt-4,gemini-pro \
  --require-consensus \
  --consensus-threshold 0.3
```

Output includes confidence intervals and flags high-disagreement cases:

```
Case 1: 7.5/10 (CI: 7.1-7.9, agreement: 0.92) ✓
Case 2: 6.2/10 (CI: 4.8-7.6, agreement: 0.45) ⚠️ FLAGGED
```

## Commands

### Eval Set Management

```bash
# Create new eval set
seer set create --name <name> --agent-id <id> [--description <desc>]

# Add case to existing set
seer set add-case <set-id> --query <query> [--expected <answer>]

# List all eval sets
seer list sets

# View eval set details
seer set view <set-id>
```

### Running Evaluations

```bash
# Run evaluation
seer run <set-id> \
  --criteria <comma-separated-list> \
  [--judge-model <model>] \
  [--ensemble <model1,model2>] \
  [--require-consensus] \
  [--consensus-threshold <0-1>]

# List all runs
seer list runs

# View run results
seer results <run-id>
```

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

## Research Foundation

Seer implements best practices from:
- Academic LLM-as-judge research (RRD framework, bias mitigation, ensemble methods)
- Glean internal evaluation practices
- Anthropic Petri 2.0 methodology
- I/O psychology lens (behavioral validation, categorical reliability)

## Development

```bash
# Type check
bun run tsc --noEmit

# Database management
bun run db:generate  # Generate migrations
bun run db:push      # Apply schema
bun run db:studio    # Open Drizzle Studio
```

## License

MIT

---

Built by Kenneth Cassel for systematic Glean agent evaluation.
