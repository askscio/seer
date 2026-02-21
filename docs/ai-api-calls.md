# Seer: AI API Call Reference

Every external AI/API call Seer makes, documented with endpoint, payload, prompt template, and return shape.

---

## Call Index

| # | Call | File | Endpoint | Agent/Model | Tools | Dynamic Fields |
|---|------|------|----------|-------------|-------|----------------|
| 1 | Agent Execution | `glean.ts` | `POST runworkflow` | Target agent | Agent's configured tools | `query` |
| 2 | Generate Inputs | `generate-agent.ts` | `POST chat` | ADVANCED (Gemini) | Company search, CRM | `agentName`, `agentDescription`, `fieldName`, `count` |
| 3 | Generate Guidance | `generate-agent.ts` | `POST chat` | ADVANCED (Gemini) | Company search, CRM | `agentName`, `agentDescription`, `input` |
| 4 | Source Doc Retrieval | `fetch-docs.ts` | `POST search` | N/A | N/A | `documentTitles` |
| 5 | Coverage Judge | `judge.ts` | `POST chat` | DEFAULT + modelSetId | None | `criteriaBlock`, `query`, `evalGuidance`, `response` |
| 6 | Quality Judge | `judge.ts` | `POST chat` | DEFAULT + modelSetId | None | `criteriaBlock`, `query`, `response` |
| 7 | Faithfulness Judge | `judge.ts` | `POST chat` | DEFAULT + modelSetId | None | `criteriaBlock`, `query`, `docContent`, `reasoningChain`, `response` |
| 8 | Factuality Judge | `judge.ts` | `POST chat` | ADVANCED + modelSetId | Company search | `criterion`, `query`, `agentSources`, `response` |
| 9 | Schema Fetch | `glean.ts` | `GET agents/{id}/schemas` | N/A | N/A | `agentId` |
| 10 | Agent Info | `fetch-agent.ts` | `GET agents/{id}` | N/A | N/A | `agentId` |

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

## Call 4: Source Document Retrieval

**File:** `src/lib/fetch-docs.ts` — `fetchSourceDocContent()`

**Endpoint:** `POST {GLEAN_BACKEND}/rest/api/v1/search`

**Auth:** `Authorization: Bearer {GLEAN_API_KEY}`

**Payload (per document):**
```json
{
  "query": "{document title}",
  "pageSize": 1,
  "requestOptions": { "facetFilters": [] }
}
```

**Purpose:** Fetches actual document content for source documents identified in the agent's reasoning chain. Called between agent execution and faithfulness judging so the judge receives real content instead of just titles.

**How it works:**
1. Extract unique document titles from `reasoningChain[].documentsRead`
2. Cap at 10 documents (focused context > exhaustive noise)
3. For each title, call search API with `pageSize: 1` to get the top match
4. Extract text snippets from the top result
5. Run all searches in parallel via `Promise.all()`
6. Return `{ title, content }[]`

**Failure handling:** If a search returns no results or errors, returns `{ title, content: '[Content not retrievable]' }`. The faithfulness judge can still evaluate — it notes which sources it couldn't verify.

**Dynamic fields:** `documentTitles` — extracted from reasoning chain

**Return shape:** `SourceDoc[]` — `{ title: string, content: string }`

---

## Call 5: Coverage Judge

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

**Prerequisite:** Eval guidance required. Skipped if no eval guidance — returns `scoreCategory: 'skipped'` with reasoning.

**Prompt template:**
```
You are an expert evaluator assessing an AI agent's response.

{criteriaBlock}

=== MATERIAL ===

<query>
{query}
</query>

<eval_guidance>
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
- `criteriaBlock` — rubric text for topical_coverage
- `query` — from eval case
- `evalGuidance` — from eval case (required — call is skipped without it)
- `response` — agent's actual response
- `scoreFormat` — XML tags for each criterion's score output

**Return shape:** XML-structured text with `<{criterion_id}_reasoning>` and `<{criterion_id}>` tags per criterion

**Parsing:** Regex extraction of reasoning + score per criterion. Categorical scores matched against `scaleConfig.categories`.

---

## Call 6: Quality Judge

**File:** `src/lib/judge.ts` — `judgeQualityBatch()`

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
You are an expert evaluator assessing the quality of an AI agent's response. You are evaluating ONLY the structure, clarity, and presentation — not factual correctness or topic coverage.

{criteriaBlock}

=== MATERIAL ===

<query>
{query}
</query>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Evaluate the response's structure, conciseness, and actionability
2. Check formatting appropriateness for the query type
3. Assess information density — concise and specific is better than verbose and padded
4. Assign a category using the rubric

Do NOT evaluate whether the response covers the right topics or contains correct facts. Focus purely on how well the information is presented.

{scoreFormat}
```

**Dynamic fields:**
- `criteriaBlock` — rubric text for response_quality
- `query` — from eval case
- `response` — agent's actual response (no eval guidance — prevents anchoring bias)
- `scoreFormat` — XML tags per criterion

**Return shape:** XML-structured text. Same parsing as Call 5.

**Key design decision:** Eval guidance is intentionally excluded to prevent anchoring bias. The judge should evaluate "is it well-written?" without knowing "what should be there."

---

## Call 7: Faithfulness Judge

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

<agent_execution_trace>
{chainText}
</agent_execution_trace>

<agent_source_documents>
The following document excerpts were retrieved by the agent during execution. Check whether the response faithfully represents what these documents say.

{docContentBlock}
</agent_source_documents>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Read the document excerpts provided above
2. Identify the key claims in the agent's response
3. For each claim, check whether it is supported by the actual content of the retrieved documents
4. Flag any claims where the response misrepresents, exaggerates, or fabricates details not in the sources
5. Assign categories using the rubrics

A response that says "no data found" when no documents were retrieved is CORRECT behavior.

<claim_check>
- "[claim]": [GROUNDED in <source>/UNGROUNDED/HEDGED/MISREPRESENTED from <source>]
</claim_check>

{scoreFormat}
```

**Dynamic fields:**
- `criteriaBlock` — rubric text for faithfulness criteria (groundedness, hallucination_risk)
- `query` — from eval case
- `chainText` — formatted reasoning chain (search queries, docs read per step)
- `docContentBlock` — pre-fetched document content from Call 4 (injected, not searched live)
- `response` — agent's actual response
- `scoreFormat` — XML tags per criterion

**Return shape:** XML-structured text. Same parsing as Call 5.

**Key design decision:** Uses `callJudge()` (DEFAULT agent) instead of the previous `callJudgeWithTools()` (ADVANCED agent). Document content is pre-fetched via Call 4 and injected into the prompt, giving us full model control via modelSetId. No search tools needed.

---

## Call 8: Factuality Judge

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

**Return shape:** XML-structured text. Same parsing pattern as Calls 5-7.

**Key difference from Calls 5-7:** Uses `callJudgeWithTools()` instead of `callJudge()` — the ADVANCED agent with `enableCompanyTools: true` gives the judge live search access to independently verify claims. This is the only dimension that genuinely needs discovery.

---

## Call 9: Schema Fetch

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

## Call 10: Agent Info

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

When `--multi-judge` is enabled (CLI) or multiple judges selected (Web UI), Calls 5-8 are executed through **all judge models** in `JUDGE_MODELS`, then aggregated:

```
runJudgePipeline() is called once per model:

Model 1 (OPUS_4_6_VERTEX)
├── Call 4: Source Doc Retrieval (shared, runs once)
├── Call 5: Coverage → scores[]
├── Call 6: Quality → scores[]
├── Call 7: Faithfulness → scores[]
└── Call 8: Factuality → scores[]

Model 2 (GPT_5)
├── Call 5: Coverage → scores[]
├── Call 6: Quality → scores[]
├── Call 7: Faithfulness → scores[]
└── Call 8: Factuality → scores[]

    ↓

aggregateScores():
├── Categorical: majority vote across models
├── Binary: majority vote (>50% yes → yes)
├── Skipped: preserved as-is (no aggregation)
├── Reasoning: all model reasonings joined, agreement % noted
└── Judge model: "ensemble(opus-4-6+gpt-5)"
```

**Concurrency:** All models run in parallel via `Promise.all()`. Failed models are filtered out — if only one succeeds, its scores are used directly.

**Model control:** Calls 5-7 use DEFAULT agent with modelSetId — full model control. Call 8 uses ADVANCED (Gemini natively).

**Current panel:** Opus 4.6 (via Vertex) + GPT-5

---

## Call Flow Diagrams

### Quick Eval (3 judge calls per case)
```
                     Call 9
                  Schema Fetch
                       │
For each case:         ▼
┌──────────────────────────────────────┐
│  Call 1: runworkflow                 │
│  → response, traceId, reasoningChain │
└──────────┬───────────────────────────┘
           │
           ▼
      Call 4: Fetch Source Docs
      → { title, content }[]
           │
     ┌─────┼──────┐
     ▼     ▼      ▼
  Call 5  Call 6  Call 7
  Cover.  Qual.   Faith.
  (eval   (query  (pre-fetched
   guid.)  only)   doc content)
     │     │      │
     └─────┼──────┘
           ▼
     Save to SQLite
```

### Deep Eval (4 judge calls per case)
```
Same as Quick, plus:
           │
           ▼
        Call 8
       Factuality
    (ADVANCED + company search)
           │
           ▼
     Save to SQLite
```

### Smart Generation (2 AI calls per case)
```
Call 10: Agent Info
Call 9: Schema Fetch
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

-- Axon | 2026-02-20
