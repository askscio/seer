# Seer Evaluation Framework

**A method-aware approach to evaluating enterprise knowledge agents**

---

## The Problem We're Solving

Enterprise knowledge agents — like those built in Glean's Agent Builder — search live company data (Salesforce, Gong, Google Drive, Confluence) and synthesize answers for users. Evaluating these agents is fundamentally harder than evaluating a chatbot or a translation model because:

1. **The ground truth changes.** Salesforce records update. New Gong calls come in. Documents get revised. An "expected answer" written today may be factually wrong tomorrow.

2. **Correctness has multiple dimensions.** A response can cover the right topics but hallucinate the details. Or be factually perfect but miss half of what was asked. Or find the right documents but present them poorly.

3. **You can't observe the agent's internal state.** You see inputs and outputs, but the reasoning — what it searched, what it read, why it chose to include certain information — is opaque unless you extract it.

4. **User context matters.** The same query returns different results for different users based on their permissions, role, and accessible data sources.

Traditional QA-pair evaluation (generate expected answers, compare) breaks down for these agents. This document describes an approach that works.

---

## Core Insight: Match the Evaluation Method to the Dimension

Not all quality dimensions can be evaluated the same way. The key insight is to categorize dimensions by **what reference material the judge needs**:

| Category | What the judge compares against | Stable over time? | Cost |
|----------|-------------------------------|-------------------|------|
| **Reference-based** | Expected answer (static QA pair) | Partially — themes are stable, facts decay | Low |
| **Reference-free** | Agent's own retrieved sources | Yes — always current | Low |
| **Search-verified** | Live company data (judge searches independently) | Yes — always current | High |
| **Direct measurement** | Execution metadata | Yes | Free |

By assigning each quality dimension to the right evaluation method, we avoid the trap of evaluating everything against static expected answers — which is the approach that fails for live-data agents.

---

## The Dimension Set

### Call 1: Coverage Judge (Reference-Based)

**What the judge sees:** Query + Expected Answer + Agent Response

**Method:** Compare the agent's response against the expected answer, treating the expected answer as a specification of themes and topics — not as exact text to match.

| Dimension | Scale | Definition |
|-----------|-------|-----------|
| **Topical Coverage** | 0-10 | What proportion of the expected themes does the response address? |
| **Response Quality** | 0-10 | Is the output well-structured, concise, actionable, and in the right format? |

**How it works:**

The judge first decomposes the expected answer into discrete themes:
```
THEME_COVERAGE:
- "Unify knowledge across tools" → COVERED (present with detail)
- "Reduce IT tickets" → TOUCHED (mentioned, no depth)
- "Speed onboarding" → MISSING
- "GTM: more selling, less searching" → COVERED
```

Then scores based on the coverage ratio, with quality adjustments for depth and actionability.

**Why this is stable:** Themes change slowly. "Snap wants to unify search across tools" is still true whether TCV is $5.9M or $6.2M. By evaluating themes rather than specific facts, the expected answer remains useful for weeks or months.

**What this cannot catch:** Whether the specific facts in the response are true. A response can hit every theme but fabricate the details.

---

### Call 2: Faithfulness Judge (Reference-Free)

**What the judge sees:** Query + Agent Response + Reasoning Chain (search queries executed, documents read)

**Method:** Check whether the agent's claims are supported by the documents it actually retrieved. No expected answer needed.

| Dimension | Scale | Definition |
|-----------|-------|-----------|
| **Groundedness** | 0-10 | Are the response's assertions supported by the documents it retrieved? |
| **Hallucination Risk** | Binary | Does the response contain specific claims (names, numbers, dates) without source backing? |

**How it works:**

The judge receives the full reasoning chain from the `runworkflow` response — this includes every search query the agent ran, every document it read, and every tool it used. The judge then checks each claim in the response against this evidence:

```
CLAIM: "Snap's priority is GTM efficiency"
SOURCE: Snap kickoff deck (found in reasoning chain) → GROUNDED

CLAIM: "Snap has 5,500 seats deployed"
SOURCE: Not found in any retrieved document → UNGROUNDED (possible hallucination)
```

**Why this is immune to staleness:** It doesn't use an expected answer. It checks the response against its own retrieval — a property of this specific run. The question is "did the agent faithfully represent what it found?" not "did it find the right thing?"

**The RAGAS connection:** This is directly inspired by RAGAS Faithfulness scoring (Shahul et al., 2023), which decomposes answers into individual claims and verifies each against the retrieved context. The key adaptation is that we use the reasoning chain from `runworkflow` as the "retrieved context" rather than RAG chunks.

**What this cannot catch:** Whether the agent retrieved the *right* documents in the first place. If it searched for the wrong things and faithfully reported what it found, groundedness is high but the answer is still wrong. That's what topical coverage (Call 1) and factuality (Call 3) are for.

---

### Call 3: Factuality Judge (Search-Verified)

**What the judge sees:** Query + Agent Response + Live Company Data (judge searches independently)

**Method:** The judge itself has access to company search tools (ADVANCED agent with `enableCompanyTools`). It independently verifies specific factual claims in the response against current data.

| Dimension | Scale | Definition |
|-----------|-------|-----------|
| **Factual Accuracy** | 0-10 | Are the specific claims in the response actually true according to current company data? |

**How it works:**

The judge extracts factual claims and verifies each:

```
CLAIM: "Snap's TCV is $5.9M"
VERIFICATION: Searched Salesforce → Found "$5.9M TCV" in opportunity record → VERIFIED

CLAIM: "Snap has deployed to 5,500 seats"
VERIFICATION: Searched deployment records → Found "5,500 licensed seats" → VERIFIED

CLAIM: "Snap's primary contact is Jane Smith"
VERIFICATION: Searched account contacts → No "Jane Smith" found → CONTRADICTED
```

**Why this needs company tools:** Factual accuracy can only be evaluated against the current state of the data. A static expected answer written last week might say TCV is $5.5M when it's now $5.9M. The judge needs live access to the same data sources the agent has.

**Why this is optional:** It's the most expensive call (the judge does its own search), and not all eval scenarios require it. For rapid iteration on agent prompts, topical coverage + groundedness (Calls 1-2) are usually sufficient. Factuality verification is for final validation before deployment.

**What this cannot catch:** Whether the agent *should have* found the data. If a document exists in the company's systems but the agent didn't retrieve it, factuality verification of the agent's claims will pass — but topical coverage will flag the missing theme.

---

### Direct Metrics (No Judge Needed)

**What we measure:** Execution metadata from the `runworkflow` response.

| Dimension | Source | Definition |
|-----------|--------|-----------|
| **Latency** | Client-side timer | End-to-end response time in milliseconds |
| **Tool Call Count** | Action metadata in fragments | Number of tools invoked (Search, Think, Generate, etc.) |
| **Search Breadth** | Reasoning chain UPDATE messages | Number of distinct search queries, documents read |

These are extracted directly from the agent execution — no LLM judge call needed, no cost, no subjectivity.

---

## Why This Works for Glean Agents

### The Reasoning Chain Is Accessible

Seer uses `POST /rest/api/v1/runworkflow` with `enableTrace: true`, which returns not just the final response but the full execution chain: search queries, documents read, tool invocations, and step flow. This is what makes reference-free evaluation (Call 2) possible — without the reasoning chain, we'd have no evidence to check groundedness against.

### Themes Are More Stable Than Facts

Enterprise knowledge agents synthesize information from multiple sources. The *topics* they should cover ("why did this customer choose Glean?") change slowly, even as the specific facts ("contract value is $X") change frequently. By separating topical coverage from factual accuracy, we can use static QA pairs for what they're good at (theme checking) and live search for what requires it (fact checking).

### The Agent's Own Search Is the Reference

Traditional RAG evaluation frameworks (RAGAS, TruLens) check faithfulness against the retrieved chunks. Glean agents work similarly — they search, read, reason, then respond. By using the agent's own reasoning chain as the faithfulness reference, we avoid the staleness problem entirely. The question "did the agent faithfully represent what it found?" is answerable from the execution trace alone.

### Company Tools Enable Live Verification

Glean's ADVANCED agent mode with `enableCompanyTools: true` gives the judge the same search capabilities the agent itself has. This means the factuality judge can independently verify claims against Salesforce, Gong, Google Drive, etc. — the same sources the agent should be drawing from.

---

## Evaluation Modes

### Quick Mode (2 judge calls per case)

```
Criteria: topical_coverage, response_quality, groundedness, hallucination_risk
Judge calls: Coverage (Call 1) + Faithfulness (Call 2)
Cost: Low
Use when: Iterating on agent prompts, A/B testing agent configs, routine checks
```

### Deep Mode (3 judge calls per case)

```
Criteria: All quick mode + factual_accuracy
Judge calls: Coverage (Call 1) + Faithfulness (Call 2) + Factuality (Call 3)
Cost: Higher (Call 3 does independent search)
Use when: Pre-deployment validation, compliance-sensitive agents, high-stakes deployments
```

### Metrics Only (0 judge calls)

```
Criteria: latency, tool_call_count, search_breadth
Judge calls: None
Cost: Free
Use when: Performance monitoring, latency regression detection
```

---

## Addressing Known Limitations

### Static QA Pair Staleness

**Problem:** Expected answers generated from company data at time T become outdated at time T+1.

**Mitigation strategy:**
1. **Topical coverage** evaluates themes, not facts — themes are slow-changing
2. **Groundedness** is reference-free — doesn't use the expected answer at all
3. **Factual accuracy** uses live search — always current
4. **Eval sets should be regenerated periodically** — Seer's smart generator can re-ground expected answers

**What we explicitly don't do:** Treat the expected answer as the single source of truth. It's a specification of themes and a guide for what "good" looks like — not a golden answer to match verbatim.

### LLM-as-Judge Biases

**Verbosity bias:** LLM judges score longer responses 10-20% higher. Mitigated by explicit anti-verbosity instructions: *"Evaluate information density, not length. A concise correct answer is better than a verbose padded one."*

**Self-enhancement bias:** Models favor outputs from their own family. Mitigated by using a different model for judging (Claude Opus 4.6 via Glean) than the model that powers the agent (Glean's internal model stack).

**Central tendency:** Judges cluster scores around 6-8/10. Mitigated by behaviorally anchored rubrics with calibration examples at 2, 5, and 9 so the judge knows what the full range looks like.

**Position bias:** The order in which expected vs actual answers are presented affects scoring. Mitigated by always showing expected answer before actual response (establishes reference frame first).

### Permission Scoping

**Problem:** Different users have access to different documents. An agent response that's complete for User A might be incomplete for User B.

**Current approach:** Evals run under the API key holder's permissions. Scores reflect what's accessible to that user. This is a known limitation — cross-user eval would require per-user API keys.

---

## Research Foundation

This framework draws from several evaluation methodologies:

| Framework | What we adopted |
|-----------|----------------|
| **RAGAS** (Shahul et al., 2023) | Faithfulness scoring via claim decomposition against retrieved context |
| **G-Eval** (Liu et al., 2023) | Chain-of-thought before scoring, evaluation step generation |
| **FreshQA** (Vu et al., 2023) | Volatility taxonomy (fast-changing vs slow-changing answers) |
| **StreamingQA** (Liska et al., 2022) | Validity-windowed eval sets |
| **Anthropic Cookbook** | XML-structured judge prompts, thinking-then-verdict pattern |
| **MT-Bench** (Zheng et al., 2023) | Pointwise scoring with anchored rubrics |
| **I/O Psychology** | Behavioral anchoring, inter-rater reliability, criterion decomposition |

### Key Papers

- **"Judging LLM-as-a-Judge" (Zheng et al., 2023):** Established that strong LLMs can approximate human judgment for open-ended evaluation when given clear rubrics.
- **"G-Eval: NLG Evaluation using GPT-4" (Liu et al., 2023):** Demonstrated that chain-of-thought reasoning before scoring improves human correlation by 10-20%.
- **"RAGAS: Automated Evaluation of RAG" (Shahul et al., 2023):** Introduced faithfulness and answer relevancy as reference-free metrics for retrieval-augmented generation.
- **"FreshQA" (Vu et al., 2023):** Taxonomized questions by temporal volatility, directly informing our approach to eval set staleness.

---

## Implementation

The evaluation framework is implemented across three files:

| File | Role |
|------|------|
| `src/lib/judge.ts` | Judge orchestration — routes to appropriate call based on requested criteria |
| `src/criteria/defaults.ts` | Dimension definitions with anchored rubrics |
| `src/data/glean.ts` | Agent execution — provides reasoning chain for faithfulness evaluation |

### Judge Call Routing

```
judgeResponse(criteria, query, response, evalGuidance, reasoningChain)
  │
  ├─ Coverage criteria requested?
  │   └─ Call 1: DEFAULT + Opus 4.6 (query + expected + response)
  │
  ├─ Faithfulness criteria requested?
  │   └─ Call 2: DEFAULT + Opus 4.6 (query + response + reasoning chain)
  │
  └─ Factuality criteria requested?
      └─ Call 3: ADVANCED + Opus 4.6 + company tools (query + response)
```

---

*This framework is designed for enterprise knowledge agents that operate on live, permission-scoped company data. It prioritizes honest measurement over comprehensive measurement — preferring a few reliable signals over many unreliable ones.*

-- Axon | 2026-02-13
