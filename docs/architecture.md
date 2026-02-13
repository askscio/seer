# Seer Architecture

**System Overview: Agent Evaluation Framework**

Seer is a multi-layered evaluation system for Glean agents that combines LLM-as-judge methodology with systematic tracking and analysis.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
├──────────────────┬──────────────────────────────────────────┤
│   CLI (Bun)      │   Web UI (Next.js) [Phase 2]            │
│   Commander.js   │   React + Tailwind                        │
└────────┬─────────┴──────────────┬───────────────────────────┘
         │                        │
         ├────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database Layer                            │
│                 SQLite + Drizzle ORM                         │
├─────────────────────────────────────────────────────────────┤
│  eval_sets │ eval_cases │ eval_criteria │ eval_runs         │
│  eval_results │ eval_scores                                 │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Evaluation Engine                          │
├──────────────────┬──────────────────┬──────────────────────┤
│  Agent Runner    │  Judge System    │  Metrics Collector   │
│  (Glean API)     │  (LLM-as-judge)  │  (Direct measures)   │
│                  │                  │                      │
│  • Form agents   │  • Continuous    │  • Latency          │
│  • Chat agents   │  • Categorical   │  • Tokens           │
│  • Response      │  • Binary        │  • Tool calls       │
│    parsing       │  • Prompting     │                     │
└──────────────────┴──────────────────┴──────────────────────┘
         │                  │                    │
         ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   External Services                          │
├──────────────────┬──────────────────┬──────────────────────┤
│  Glean Agent API │  Glean Chat API  │  (Future: OpenAI)   │
│  (REST)          │  (TypeScript SDK) │                     │
└──────────────────┴──────────────────┴──────────────────────┘
```

---

## Component Architecture

### 1. CLI Layer (`src/cli.ts`)

**Technology:** Commander.js + Bun runtime

**Responsibilities:**
- Parse user commands and options
- Validate inputs
- Orchestrate database operations
- Format output for terminal display
- Handle interactive prompts

**Commands:**
```typescript
seer set create           // Create eval set
seer set add-case         // Add test case
seer set view             // View set details
seer list sets            // List all sets
seer list runs            // List all runs
seer run <set-id>         // Execute evaluation
seer results <run-id>     // Display results
seer generate <agent-id>  // Generate eval set with AI [Phase 2C]
```

**Dependencies:**
- `commander` - CLI framework
- `chalk` - Terminal colors
- `readline` - Interactive input
- Database layer
- Evaluation engine

---

### 2. Database Layer

**Technology:** SQLite + Drizzle ORM

**Location:** `src/db/`

#### Schema Design

**Six core tables with relational integrity:**

```typescript
// 1. eval_sets - Collections of test cases
{
  id: string (PK)
  name: string
  description: string
  agentId: string
  createdAt: timestamp
}

// 2. eval_cases - Individual test queries
{
  id: string (PK)
  evalSetId: string (FK → eval_sets)
  query: string
  expectedAnswer: string (nullable)
  context: string (nullable)
  createdAt: timestamp
}

// 3. eval_criteria - Scoring dimensions
{
  id: string (PK)
  name: string (unique)
  description: string
  scoreType: 'continuous' | 'categorical' | 'binary' | 'metric'
  rubric: text (JSON)
  createdAt: timestamp
}

// 4. eval_runs - Evaluation executions
{
  id: string (PK)
  evalSetId: string (FK → eval_sets)
  judgeModel: string
  criteriaIds: text (JSON array)
  overallScore: number (nullable)
  startedAt: timestamp
  completedAt: timestamp (nullable)
}

// 5. eval_results - Agent responses per case
{
  id: string (PK)
  runId: string (FK → eval_runs)
  caseId: string (FK → eval_cases)
  agentResponse: text
  latency: number
  tokenCount: number (nullable)
  toolCallCount: number
  createdAt: timestamp
}

// 6. eval_scores - Individual criterion scores
{
  id: string (PK)
  resultId: string (FK → eval_results)
  criterionId: string (FK → eval_criteria)
  score: number (nullable)
  category: string (nullable)
  reasoning: text
  createdAt: timestamp
}
```

#### Files:
- `schema.ts` - Drizzle schema definitions
- `index.ts` - Database connection, query helpers
- `seed.ts` - Default criteria seeding
- `migrate.ts` - Migration runner
- `migrations/` - Generated SQL migrations

**Data Flow:**
```
Create Set → Add Cases → Run Evaluation → Store Results → Query/Display
```

---

### 3. Integration Layer

**Location:** `src/data/` and `src/lib/`

#### Glean Agent API Client (`src/data/glean.ts`)

**Purpose:** Execute custom Glean agents and capture responses

**Key Features:**
- Auto-detects agent type (form-based vs chat-based)
- Fetches agent schema before execution
- Handles both input formats:
  - **Form agents:** `{ input: { field: value } }`
  - **Chat agents:** `{ messages: [...] }`
- Parses response text from GLEAN_AI messages
- Measures latency
- Extracts tool calls

**Implementation:**
```typescript
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string
): Promise<AgentResult> {
  // 1. Fetch schema
  const schema = await getAgentSchema(agentId)

  // 2. Determine input type
  const hasFormInputs = Object.keys(schema.input_schema).length > 0

  // 3. Execute agent
  const response = await fetch('/agents/runs/wait', {
    method: 'POST',
    body: hasFormInputs
      ? { agent_id: agentId, input: {...} }
      : { agent_id: agentId, messages: [...] }
  })

  // 4. Extract response
  return {
    text: extractText(response),
    latency: Date.now() - startTime,
    toolCalls: extractToolCalls(response)
  }
}
```

#### Glean Chat API Client (via TypeScript SDK)

**Purpose:** LLM-as-judge evaluations using Glean chat

**Location:** `src/lib/judge.ts` (judge system uses chat API internally)

**Implementation:**
```typescript
import { Glean } from '@gleanwork/api-client'

const glean = new Glean({
  apiToken: config.gleanChatApiKey,
  instance: config.gleanInstance
})

async function callGleanChat(prompt: string): Promise<string> {
  const response = await glean.client.chat.create({
    messages: [{ author: 'USER', fragments: [{ text: prompt }] }],
    saveChat: false
  })

  return extractResponseText(response)
}
```

---

### 4. Judge Layer (`src/lib/judge.ts`)

**Purpose:** LLM-as-judge scoring across all score types

**Supports Four Score Types:**

#### A. Continuous (0-10)
```typescript
scoreType: 'continuous'
rubric: {
  "10": "Fully addresses query, achieves intended outcome",
  "7-9": "Mostly complete, minor improvements possible",
  "4-6": "Partially complete, missing key elements",
  "1-3": "Barely addresses task, major gaps",
  "0": "Completely fails the task"
}
```

**Prompt Structure:**
```
You are evaluating: [criterion name]
Query: [user query]
Agent Response: [response]
Expected: [expected answer if provided]

Score from 0-10 based on this rubric:
[rubric]

Format:
SCORE: [number]
REASONING: [explanation]
```

#### B. Categorical
```typescript
scoreType: 'categorical'
rubric: {
  categories: ["complete", "partial", "incomplete"],
  definitions: {
    "complete": "Addresses all aspects with appropriate depth",
    "partial": "Addresses most aspects but missing details",
    "incomplete": "Missing major aspects or very superficial"
  }
}
```

#### C. Binary
```typescript
scoreType: 'binary'
rubric: {
  yes: "Agent used appropriate tools",
  no: "Agent used wrong/missing tools"
}
```

#### D. Metrics
```typescript
scoreType: 'metric'
// Direct measurement - no judge prompt needed
// Extract from agent response metadata
```

**Response Parsing:**
- Regex extraction: `/SCORE:\s*(\d+)/`, `/CATEGORY:\s*(\w+)/`
- Fallback to LLM re-parse if format invalid
- Store reasoning for all scored criteria

---

### 5. Metrics Collector (`src/lib/metrics.ts`)

**Purpose:** Extract direct measurements from agent responses

**Metrics:**
1. **Latency** - Response time in milliseconds
2. **Token Count** - Total tokens used (from response metadata)
3. **Tool Call Count** - Number of tool invocations

**Implementation:**
```typescript
export function extractMetrics(response: any, startTime: number) {
  return {
    latency: Date.now() - startTime,
    tokenCount: response.metadata?.tokens || null,
    toolCallCount: countToolCalls(response)
  }
}
```

---

### 6. Web UI Layer (Phase 2B)

**Technology:** Next.js 14 (App Router) + React + Tailwind CSS

**Location:** `web/`

**Architecture:**
```
web/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Dashboard
│   ├── sets/
│   │   ├── [id]/page.tsx       # Eval set detail
│   │   └── new/page.tsx        # Create set
│   ├── runs/
│   │   └── [id]/page.tsx       # Results view
│   └── api/
│       ├── sets/route.ts       # CRUD for eval sets
│       ├── cases/route.ts      # CRUD for cases
│       └── generate/route.ts   # AI generation endpoint
├── components/
│   ├── EvalSetCard.tsx
│   ├── CaseEditor.tsx
│   └── ResultsTable.tsx
└── lib/
    └── db.ts                   # Shared DB access
```

**Shared Database:**
```typescript
// Points to same SQLite DB as CLI
const dbPath = join(process.cwd(), '..', 'data', 'seer.db')
export const db = drizzle(new Database(dbPath))
```

**Key Pages:**
1. **Dashboard** - List eval sets, quick actions
2. **Eval Set Detail** - View/edit cases, run evaluations
3. **Run Results** - Visualize scores, view reasoning
4. **Create Set** - Form + AI generation option

---

### 7. AI Generation System (Phase 2C)

**Purpose:** Generate eval sets using Glean chat (grounded in company context)

**Location:** `src/lib/generate.ts`

**Flow:**
```
1. User provides agent ID
2. Fetch agent schema (form fields or chat-style)
3. Generate eval set metadata via Glean chat:
   - Set name
   - Description
4. Generate test cases via Glean chat:
   - Form-based: Cover different field combinations
   - Chat-based: Conversational queries
5. Optionally generate expected behaviors
6. Present to user for review/edit
7. Save to database on approval
```

**Grounding Strategy:**
- Use Glean chat API (accesses company knowledge)
- Include agent schema in prompt for context
- Ask for realistic queries based on company data
- Generate expected behaviors aligned with agent purpose

**Implementation:**
```typescript
export async function generateEvalSet(req: GenerateEvalSetRequest) {
  // Step 1: Generate metadata
  const metadata = await generateSetMetadata(agentId, schema)

  // Step 2: Generate test cases
  const cases = await generateTestCases(agentId, schema, count)

  // Step 3: Return for human review
  return { name: metadata.name, description, cases }
}
```

---

## Data Flow

### Evaluation Execution Flow

```
1. User triggers: seer run <set-id>
   ↓
2. CLI validates set exists, criteria valid
   ↓
3. Create eval_runs record
   ↓
4. For each eval_case:
   ├─→ Run agent (Glean API)
   ├─→ Store eval_results (response + metrics)
   ├─→ For each criterion:
   │   ├─→ If metric: extract directly
   │   ├─→ If scored: call judge (LLM)
   │   └─→ Store eval_scores (score + reasoning)
   ↓
5. Calculate overall score (average)
   ↓
6. Update eval_runs.completedAt
   ↓
7. Display results summary
```

### AI Generation Flow (Phase 2C)

```
1. User: seer generate <agent-id>
   ↓
2. Fetch agent schema from Glean API
   ↓
3. Prompt Glean chat:
   "Generate eval set name/description for agent with schema X"
   ↓
4. Prompt Glean chat:
   "Generate N test cases for agent (form fields: Y)"
   ↓
5. Parse generated cases from chat response
   ↓
6. Display preview to user
   ↓
7. User approves/edits
   ↓
8. Save to database (eval_sets + eval_cases)
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Bun | Fast TypeScript execution, SQLite support |
| **CLI** | Commander.js | Command parsing, options |
| **Database** | SQLite + Drizzle ORM | Persistent storage, type-safe queries |
| **Web Framework** | Next.js 14 | Server + client components, API routes |
| **UI** | React + Tailwind CSS | Component-based UI, utility styling |
| **Agent API** | Glean REST API | Execute custom agents |
| **Chat API** | Glean TypeScript SDK | Judge calls, AI generation |
| **Types** | TypeScript | Type safety across system |

---

## Design Decisions

### Why SQLite?
- No external database server needed
- Full relational model with foreign keys
- Shared between CLI and web UI
- Easy to query, backup, migrate
- Perfect for single-instance tool

### Why All Score Types?
Different evaluation dimensions need different scales:
- **Continuous** - Nuanced quality assessment
- **Categorical** - Clear tiers without false precision
- **Binary** - Simple yes/no decisions
- **Metrics** - Direct measurements

Building complete system upfront avoids retrofitting.

### Why CLI-First?
- Technical users (AIOMs, developers) prefer terminal
- Faster to build and iterate
- Easy to script and automate
- Web UI is progressive enhancement

### Why Glean Chat for Judge?
- Grounded in company knowledge
- Same context as evaluated agents
- No external API dependency
- Unified authentication

---

## Performance Considerations

### Bottlenecks
1. **Agent execution** - Blocking API calls (1-5s per case)
2. **Judge calls** - LLM inference (2-3s per criterion per case)
3. **Database writes** - Negligible with SQLite

### Optimization Strategies
- **Parallel case execution** - Run multiple cases concurrently
- **Batch judge calls** - Group criteria where possible
- **Metric extraction** - Avoid judge calls for direct measurements
- **Web UI pagination** - Limit initial results load

### Scalability
Current design optimized for:
- **Eval sets:** 1-100 per user
- **Cases per set:** 5-50
- **Criteria per run:** 3-10
- **Runs per month:** 10-100

For higher scale, consider:
- PostgreSQL instead of SQLite
- Background job queue for evaluations
- Caching layer for agent schemas

---

## Security Considerations

### API Keys
- Stored in `.env` (gitignored)
- Never logged or exposed in UI
- Validated on startup

### Database
- SQLite file-based (local access only)
- No authentication needed (single-user tool)
- Regular backups recommended

### Web UI (Phase 2B)
- Runs locally (localhost:3000)
- No authentication (local dev tool)
- CORS not needed (same origin)

---

## Error Handling

### Agent API Failures
- Network errors → Retry with exponential backoff
- Invalid agent ID → Fail fast with clear message
- Schema fetch failure → Cannot proceed with eval

### Judge Failures
- Unparseable response → Re-prompt with format examples
- Network timeout → Mark criterion as failed
- Invalid score → Store null, log error

### Database Errors
- Connection failure → Exit with error
- Foreign key violation → Validate before insert
- Migration failure → Rollback transaction

---

## Testing Strategy

### Current State (Phase 1)
- Manual testing via CLI
- Database schema validation
- No automated tests yet

### Recommended (Future)
- **Unit tests:** Judge prompt generation, metric extraction
- **Integration tests:** Full eval flow with mock APIs
- **E2E tests:** CLI commands end-to-end
- **Web UI tests:** Component rendering, form validation

---

## Future Enhancements

### Phase 3: Multi-Judge Ensemble
- Parallel execution of 2-3 judge models
- Score aggregation (mean/median)
- Agreement metrics (std dev, Cohen's kappa)
- Confidence intervals
- High-disagreement flagging

### Phase 4: Advanced Features
- Custom criteria builder
- Behavioral validation (detect gaming)
- Export to CSV/JSON
- Comparison view (run A vs run B)
- Agent improvement suggestions

---

**Last Updated:** 2026-02-13
**Phase:** 2A Implementation
**Maintained By:** Kenneth Cassel / Axon
