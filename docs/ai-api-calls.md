# Seer: AI API Call Reference

Every external AI/API call Seer makes, documented with endpoint, payload, prompt template, and return shape.

---

## Call Index

| # | Call | File | Endpoint | Agent/Model | Tools | Dynamic Fields |
|---|------|------|----------|-------------|-------|----------------|
| 1 | Agent Execution | `glean.ts` | `POST runworkflow` | Target agent | Agent's configured tools | `query` |
| 2 | Generate Inputs | `generate-agent.ts` | `POST chat` | ADVANCED (Gemini) | Company search, CRM | `agentName`, `agentDescription`, `fieldName`, `count` |
| 3 | Generate Guidance | `generate-agent.ts` | `POST chat` | ADVANCED (Gemini) | Company search, CRM | `agentName`, `agentDescription`, `input` |
| 4 | Coverage Judge | `judge.ts` | `POST chat` | OPUS_4_6_VERTEX | None | `criteriaBlock`, `query`, `evalGuidance`, `response` |
| 5 | Faithfulness Judge | `judge.ts` | `POST chat` | OPUS_4_6_VERTEX | None | `criteriaBlock`, `query`, `reasoningChain`, `response` |
| 6 | Factuality Judge | `judge.ts` | `POST chat` | ADVANCED + modelSetId | Company search | `criterion`, `query`, `agentSources`, `response` |
| 7 | Schema Fetch | `glean.ts` | `GET agents/{id}/schemas` | N/A | N/A | `agentId` |
| 8 | Agent Info | `fetch-agent.ts` | `GET agents/{id}` | N/A | N/A | `agentId` |

---

## Call 1: Agent Execution

**File:** `src/data/glean.ts` — `runAgent()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/runworkflow`

**Auth:** `Authorization: Bearer {GLEAN_API_KEY}`

**Payload (form-based agent):**
```json
{
  "workflowId": "{agentId}",
  "fields": { "{inputField}": "{query}" },
  "stream": false,
  "enableTrace": true
}
```

**Payload (chat-style agent):**
```json
{
  "workflowId": "{agentId}",
  "messages": [{ "author": "USER", "fragments": [{ "text": "{query}" }] }],
  "stream": false,
  "enableTrace": true
}
```

**agentConfig:** None — this calls the target agent directly, not the chat API.

**Dynamic fields:**
- `agentId` — from eval set config
- `query` — from eval case
- `inputField` — auto-detected from Call 7 (schema fetch)

**Return shape:**
```typescript
{
  messages: [{
    author: "GLEAN_AI",
    messageType: "CONTENT" | "UPDATE",
    fragments: [{ text?: string, action?: {...}, structuredResults?: [...] }],
    workflowTraceId?: string,
    stepId?: string,
  }]
}
```

**Extraction:**
- Response text: CONTENT messages → text fragments joined
- Tool calls: action fragments from GLEAN_AI messages
- Reasoning chain: UPDATE messages → search queries, documents read, actions
- Trace ID: `workflowTraceId` from first message

**Timeout:** 120s (via `AbortSignal.timeout`)

---

## Call 2: Generate Inputs

**File:** `src/lib/generate-agent.ts` — `findRealisticInputs()` via `askAgent()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/chat`

**agentConfig:**
```json
{
  "agent": "ADVANCED",
  "toolSets": { "enableCompanyTools": true }
}
```

**Prompt template:**
```
I'm testing a Glean agent called "{agentName}".
Description: {agentDescription}

It takes a form input field called "{fieldName}".

Search our company data (CRM, success plans, accounts, etc.) and give me exactly {count} real, diverse values for "{fieldName}" that I can use to test this agent.

Include a mix of:
- Well-known values that should produce good results
- At least 1 edge case (misspelling, unusual casing, or abbreviation)
- At least 1 boundary case (internal/test account or non-existent value)

Return ONLY a plain numbered list. No explanations, no markdown formatting, no bullets. Just:
1. Value one
2. Value two
...
```

**Dynamic fields:** `agentName`, `agentDescription`, `fieldName`, `count`

**Return shape:** Plain text numbered list, parsed line-by-line into `Record<string, string>[]`

**Timeout:** 60s (`timeoutMillis` in payload)

---

## Call 3: Generate Guidance

**File:** `src/lib/generate-agent.ts` — `generateExpectedOutput()` via `askAgent()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/chat`

**agentConfig:**
```json
{
  "agent": "ADVANCED",
  "toolSets": { "enableCompanyTools": true }
}
```

**Prompt template:**
```
I'm testing a Glean agent called "{agentName}".
Description: {agentDescription}

The agent was given this input: {inputStr}

Search our company's documents for materials related to this input. Then describe what a GOOD response from this agent should look like in 3-5 sentences:
- What topics/themes should it cover based on what you found?
- What sources should it reference?
- What would make the response WRONG or hallucinated?
- If no relevant data exists, say the expected behavior is "agent should state no data found."

Be specific and concrete. No generic advice.
```

**Dynamic fields:** `agentName`, `agentDescription`, `inputStr` (formatted key-value pairs)

**Return shape:** Free-text eval guidance (3-5 sentences), trimmed and stored as `evalGuidance`

**Timeout:** 60s (`timeoutMillis` in payload)

---

## Call 4: Coverage Judge

**File:** `src/lib/judge.ts` — `judgeCoverageBatch()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/chat`

**agentConfig:**
```json
{
  "agent": "DEFAULT",
  "modelSetId": "OPUS_4_6_VERTEX"
}
```

**Additional settings:** `saveChat: false`, `timeoutMillis: 120000`

**Prompt template:**
```
You are an expert evaluator assessing an AI agent's response.

{criteriaBlock}

=== MATERIAL ===

<query>
{query}
</query>

<eval_guidance>          ← only if evalGuidance is provided
{evalGuidance}
</eval_guidance>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Extract the key themes from the eval guidance
2. For each theme, classify coverage: COVERED / TOUCHED / MISSING
3. Assign a category for each dimension using the rubric

The eval guidance describes ONE valid answer, not THE only valid answer. Do not penalize different wording or additional correct information. Evaluate information density, not length.

<theme_coverage>
- [theme]: [COVERED/TOUCHED/MISSING]
</theme_coverage>

{scoreFormat}
```

**Dynamic fields:**
- `criteriaBlock` — rubric text for each coverage criterion (topical_coverage, response_quality)
- `query` — from eval case
- `evalGuidance` — from eval case (optional)
- `response` — agent's actual response
- `scoreFormat` — XML tags for each criterion's score output

**Return shape:** XML-structured text with `<{criterion_id}_reasoning>` and `<{criterion_id}>` tags per criterion

**Parsing:** Regex extraction of reasoning + score per criterion. Categorical scores matched against `scaleConfig.categories`.

---

## Call 5: Faithfulness Judge

**File:** `src/lib/judge.ts` — `judgeFaithfulnessBatch()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/chat`

**agentConfig:**
```json
{
  "agent": "DEFAULT",
  "modelSetId": "OPUS_4_6_VERTEX"
}
```

**Additional settings:** `saveChat: false`, `timeoutMillis: 120000`

**Prompt template:**
```
You are evaluating whether an AI agent's response is faithful to what it actually retrieved. You are NOT checking correctness — only whether it accurately represents what was found.

{criteriaBlock}

=== MATERIAL ===

<query>
{query}
</query>

<reasoning_chain>
{chainText}
</reasoning_chain>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Identify key claims in the response
2. Check each against the documents in the reasoning chain
3. Assign categories using the rubrics

A response that says "no data found" when no documents were retrieved is CORRECT behavior.

<claim_check>
- "[claim]": [GROUNDED/UNGROUNDED/HEDGED]
</claim_check>

{scoreFormat}
```

**Dynamic fields:**
- `criteriaBlock` — rubric text for faithfulness criteria (groundedness, hallucination_risk)
- `query` — from eval case
- `chainText` — formatted reasoning chain (search queries, docs read per step)
- `response` — agent's actual response
- `scoreFormat` — XML tags per criterion

**Return shape:** XML-structured text. Same parsing as Call 4.

**Note:** The reasoning chain comes from Call 1's execution trace — UPDATE messages containing search queries, document titles/URLs, and action metadata.

---

## Call 6: Factuality Judge

**File:** `src/lib/judge.ts` — `judgeFactuality()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/chat`

**agentConfig:**
```json
{
  "agent": "ADVANCED",
  "modelSetId": "{model.id}",
  "toolSets": { "enableCompanyTools": true }
}
```

**Additional settings:** `saveChat: false`, `timeoutMillis: 120000`

**Prompt template:**
```
You are a factual accuracy evaluator. Use your company search tools to independently verify the claims in this AI agent's response. Cite your sources for each verification.

=== {CRITERION_ID} ===
{criterion.name}: {criterion.description}

{criterion.rubric}

=== MATERIAL ===

<query>
{query}
</query>

<agent_sources>               ← only if agent retrieved documents
The agent retrieved these documents during execution:
- {source1}
- {source2}
...
</agent_sources>

<agent_response>
{response}
</agent_response>

=== INSTRUCTIONS ===

1. Extract key factual claims (names, numbers, dates, specifics)
2. Search company data to verify each — also check the agent's own retrieved sources if listed above
3. Classify each claim AND cite your source document/system
4. Assign a category

<claim_verification>
- "[claim]": [VERIFIED/IMPRECISE/UNVERIFIABLE/CONTRADICTED/FABRICATED] (source: [what you found and where])
</claim_verification>

<{criterion_id}_reasoning>[Analysis of factual accuracy with source citations]</{criterion_id}_reasoning>
<{criterion_id}>[{categories}]</{criterion_id}>
```

**Dynamic fields:**
- `criterion` — single factuality criterion definition (factual_accuracy)
- `query` — from eval case
- `agentSources` — document titles from agent's reasoning chain (max 20)
- `response` — agent's actual response

**Return shape:** XML-structured text. Same parsing pattern as Calls 4-5.

**Key difference from Calls 4-5:** Uses `callJudgeWithTools()` instead of `callJudge()` — the ADVANCED agent with `enableCompanyTools: true` gives the judge live search access to independently verify claims.

---

## Call 7: Schema Fetch

**File:** `src/data/glean.ts` — `getAgentSchema()`

**Endpoint:** `GET {GLEAN_BACKEND}/rest/api/v1/agents/{agentId}/schemas`

**Auth:** `Authorization: Bearer {GLEAN_API_KEY}`

**Return shape:**
```typescript
{
  agent_id: string
  input_schema?: Record<string, { type: string, description?: string, enum?: string[] }>
  output_schema?: any
}
```

**Purpose:** Determines whether the agent is form-based (has `input_schema` fields) or chat-style (no fields). This drives:
- Call 1: whether to use `fields` (form) or `messages` (chat) in `runworkflow`
- Call 2: which `fieldName` to ask the generator about
- Cache: schemas are cached in `schemaCache` Map within a session

---

## Call 8: Agent Info

**File:** `src/lib/fetch-agent.ts` — `fetchAgentInfo()`

**Endpoint:** `GET {GLEAN_BACKEND}/rest/api/v1/agents/{agentId}`

**Auth:** `Authorization: Bearer {GLEAN_API_KEY}`

**Return shape:**
```typescript
{
  agent_id: string
  name: string
  description: string
}
```

**Purpose:** Fetches agent name and description for:
- Pre-filling eval set name/description in the setup flow
- Providing context to Calls 2-3 (generate inputs/guidance)
- Displaying agent info in the web UI

---

## Multi-Judge Flow

When `--multi-judge` is enabled (CLI) or multiple judges selected (Web UI), Calls 4-6 are executed through **all judge models** in `JUDGE_MODELS`, then aggregated:

```
runJudgePipeline() is called once per model:

Model 1 (OPUS_4_6_VERTEX)
├── Call 4: Coverage → scores[]
├── Call 5: Faithfulness → scores[]
└── Call 6: Factuality → scores[]

Model 2 (GPT_5)
├── Call 4: Coverage → scores[]
├── Call 5: Faithfulness → scores[]
└── Call 6: Factuality → scores[]

    ↓

aggregateScores():
├── Categorical: majority vote across models
├── Binary: majority vote (>50% yes → yes)
├── Reasoning: all model reasonings joined, agreement % noted
└── Judge model: "ensemble(opus-4-6+gpt-5)"
```

**Concurrency:** All models run in parallel via `Promise.all()`. Failed models are filtered out — if only one succeeds, its scores are used directly.

**Current panel:** Opus 4.6 (via Vertex) + GPT-5

---

## Call Flow Diagrams

### Quick Eval (2 judge calls per case)
```
                     Call 7
                  Schema Fetch
                       │
For each case:         ▼
┌──────────────────────────────────────┐
│  Call 1: runworkflow                 │
│  → response, traceId, reasoningChain │
└──────────┬───────────────────────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
  Call 4       Call 5
  Coverage     Faithfulness
  (+ eval      (+ reasoning
   guidance)    chain)
     │            │
     └─────┬──────┘
           ▼
     Save to SQLite
```

### Deep Eval (3 judge calls per case)
```
Same as Quick, plus:
           │
           ▼
        Call 6
       Factuality
    (+ company search)
           │
           ▼
     Save to SQLite
```

### Smart Generation (2 AI calls per case)
```
Call 8: Agent Info
Call 7: Schema Fetch
     │
     ▼
  Call 2: Generate Inputs (×1)
  → list of realistic values
     │
     ▼
  For each input:
  Call 3: Generate Guidance (×N)
  → eval guidance per case
     │
     ▼
  Preview → Save to SQLite
```

---

*This document maps every AI API call. For evaluation methodology, see `evaluation-framework.md`. For system architecture, see `architecture.md`.*

-- Axon | 2026-02-18
