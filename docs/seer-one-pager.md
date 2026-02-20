# Evaluating AI Agents on Live Company Data

*How Seer approaches the hard problem of measuring agent quality when the "right answer" keeps changing.*

---

## The Problem

Enterprise AI agents — like those built in Glean's Agent Builder — don't work like traditional chatbots. They search live company data across Salesforce, Gong, Google Drive, Confluence, Slack, and dozens of other sources to synthesize answers. This makes them powerful, but it also makes them fundamentally hard to evaluate.

Here's why:

**The ground truth changes.** A Salesforce record updates. A new Gong call comes in. A document gets revised. An "expected answer" written on Monday may be factually wrong by Friday. If your evaluation compares the agent's response against a static answer, you'll get false negatives — the agent is right, but the test says it's wrong.

**Correctness isn't one thing.** A response can cover the right topics but hallucinate the details. Or be factually perfect but miss half of what was asked. Or find the right documents but present them in a way that's hard to act on. Single-score evaluation ("is this answer correct?") collapses these distinct failure modes into one number.

**The agent's process is opaque.** You see what went in and what came out, but not what happened in between — what the agent searched for, which documents it read, why it chose to include certain information. Without visibility into the reasoning chain, you can't distinguish "retrieved the wrong documents" from "retrieved the right documents but summarized them badly."

**User context matters.** The same query returns different results for different users based on their permissions, role, and accessible data sources. An answer that's complete for one user may be incomplete for another — not because the agent failed, but because the data is permission-scoped.

Traditional QA-pair evaluation — write expected answers, compare against them, score — breaks down in this environment. The evaluation harness itself becomes a source of noise, eroding trust in scores that should be helping you improve your agents.

---

## What the Research Says

This isn't a new problem. The AI evaluation community has been studying how static benchmarks degrade over time, and several research threads converge on the same conclusion: **you can't evaluate dynamic systems with static ground truth alone.**

### Eval Decay

The most relevant research comes from temporal QA — evaluating systems where answers change over time:

- **FreshQA** (Vu et al., 2023, Google Research) introduced a taxonomy of question volatility: *never-changing* ("What year did WWII end?"), *slow-changing* ("Who is the CEO of Google?"), and *fast-changing* ("What is the current stock price?"). Enterprise agent queries are overwhelmingly fast-changing — the answer depends on data that updates daily or weekly.

- **StreamingQA** (Liska et al., 2022, DeepMind) formalized the concept of **answer validity windows** — the period during which an expected answer is still correct. After that window closes, scoring against the expected answer produces false negatives. For enterprise data, these windows can be as short as hours.

- **LiveBench** (White et al., 2024) demonstrated that static benchmarks can be kept fresh by continuously regenerating questions from recent data — but this requires constant maintenance that most teams can't sustain.

The practitioner term for this phenomenon is **eval decay**: the gradual degradation of evaluation quality as the gap between when test cases were written and when they're run widens.

### LLM-as-Judge Limitations

Using an LLM to judge agent responses (instead of exact string matching) is a significant improvement, but introduces its own problems:

- **Verbosity bias**: LLM judges consistently score longer responses 10-20% higher, regardless of actual quality (Zheng et al., 2023). A verbose, padded response scores better than a concise, correct one.

- **Self-enhancement bias**: Models tend to favor outputs from their own model family. A GPT judge rates GPT outputs higher; a Claude judge rates Claude outputs higher.

- **Factual unreliability**: LLM judges are unreliable for knowledge-intensive, domain-specific evaluation (Siro et al., 2025 — GER-Eval). They'll confidently score factual accuracy without actually knowing whether the facts are correct — because the facts are about *your* company, not the public internet.

- **Central tendency**: Judges cluster scores around 6-8 on a 10-point scale, making it hard to distinguish good from great or bad from terrible.

### What Works

The research points to several approaches that hold up:

1. **Reference-free evaluation** (RAGAS, Shahul et al., 2023): Instead of comparing against a static expected answer, check whether the response is faithful to what the agent actually retrieved. This is immune to eval decay because it uses the agent's own retrieval as the reference.

2. **Categorical scoring** (SJT research, Cavanagh, 2026): Forcing the judge to commit to a defined category ("full / substantial / partial / minimal / failure") rather than picking an arbitrary number on a 1-10 scale improves reliability by 15% and validity by 37%. The judge can't hide in the middle.

3. **Chain-of-thought before scoring** (G-Eval, Liu et al., 2023): Having the judge reason through its evaluation before assigning a score improves correlation with human judgment by 10-20%. Reasoning first, scoring second.

4. **Multi-judge panels** (Verga et al., 2024): Running the same evaluation through multiple models from different families (e.g., Claude + GPT + Gemini) and aggregating via majority vote reduces model-specific biases. Single judges show 3.4x over-flagging rates on certain dimensions.

5. **Tool-grounded factuality** (GER-Eval, Siro et al., 2025): For factual claims about domain-specific data, the judge needs access to search tools — not just its parametric knowledge. An LLM judge without search access will confidently hallucinate factual assessments.

---

## Our Approach

Seer combines these research insights with practical knowledge of how Glean agents work — how they search, what they retrieve, and how their schemas define their input/output contracts.

### Themes Instead of Exact Answers

The core design decision: each test case includes **eval guidance** rather than an expected answer. Eval guidance describes the *themes and topics* a good response should cover — not the specific words or facts it should contain.

**Example 1: IT Help Desk Agent**

Query: *"How do I reset my password?"*

| | Traditional Expected Answer | What Changed |
|---|---|---|
| | *"Go to okta.company.com/reset, click 'Forgot Password', enter your corporate email, and follow the MFA verification steps. If you're still locked out, contact IT in #it-helpdesk on Slack."* | The company migrated from Okta to Microsoft Entra ID. The old URL is dead. The Slack channel was renamed to #tech-support. |

The agent correctly tells users to go to Entra and use #tech-support. The eval scores it as **FAIL** — because the expected answer says Okta.

Eval guidance: *"Should identify the current identity provider, link to the self-service password reset flow, describe the verification steps, and provide an escalation path if self-service fails."*

✓ Still valid. The themes (identity provider, self-service flow, verification, escalation) haven't changed — only the specific tools have.

**Example 2: New Hire Onboarding Agent**

Query: *"What do I need to set up in my first week?"*

| | Traditional Expected Answer | What Changed |
|---|---|---|
| | *"1) Set up Slack. 2) Configure Google Workspace. 3) Request access to Jira and Confluence through IT. 4) Complete compliance training in Workday Learning by Friday. 5) Schedule a 1:1 with your manager."* | The company switched from Jira to Linear, compliance training moved to a new LMS, and the onboarding checklist now includes setting up Glean. |

The agent gives the updated list with Linear, the new LMS, and Glean. The eval scores it as **FAIL** — three of five items don't match.

Eval guidance: *"Should cover communication tools setup, productivity suite access, project management tool access, required compliance training with deadline, and manager introduction. Should reference the current onboarding checklist if one exists."*

✓ Still valid. The categories of setup tasks are stable even though every specific tool name changed.

---

The pattern is the same in both cases: **facts change, themes don't.** Eval guidance captures the themes — what topics a good response should address — so your test sets remain valid without constant maintenance.

### Grounded in Glean's Own Data

Seer uses Glean's search and chat capabilities to ground both test case generation and evaluation in current company data:

- **Test case generation**: When you create an eval set, Seer reads the agent's schema (form fields, input types) and uses Glean's ADVANCED agent with company search tools to find realistic inputs from your actual CRM, success plans, and documents. For each input, it searches for relevant materials and generates eval guidance based on what exists — not what someone imagines should exist.

- **Factuality verification**: When running deep evaluations, the judge itself has access to Glean's search tools and independently verifies specific claims in the agent's response against current company data. This is the only reliable way to check factual accuracy for enterprise-specific information.

### Schema-Aware Evaluation

Glean agents can accept different input types — free text chat, single form fields (e.g., "Account Name"), or structured multi-field forms (e.g., "Account Name" + "Industry" + "Similar Account"). Seer detects the agent's schema automatically and adapts:

- The test case generator produces appropriately structured inputs for each field
- The eval runner populates all form fields when executing the agent
- Multi-field inputs are stored and displayed with their full structure

This means you can evaluate complex, structured agents — not just simple Q&A bots.

---

## How Evaluation Works

### Three Judge Calls, Three Methods

Not all quality dimensions can be measured the same way. Seer uses three distinct judge calls, each designed for a specific type of evaluation:

**Call 1: Coverage (Reference-Based)**

The judge receives the query, the eval guidance, and the agent's response. It decomposes the eval guidance into discrete themes, then classifies each theme as COVERED (present with useful detail), TOUCHED (mentioned without depth), or MISSING (absent entirely).

This answers: *"Did the agent address the topics it should have?"*

- Requires eval guidance
- Themes are stable — decays slowly
- Catches: missed topics, incomplete responses, wrong focus areas

**Call 2: Faithfulness (Reference-Free)**

The judge receives the query, the agent's full reasoning chain (what it searched, which documents it read, what tools it used), and the response. It checks whether the claims in the response are actually supported by the documents the agent retrieved.

This answers: *"Did the agent faithfully represent what it found?"*

- Does NOT use eval guidance — immune to eval decay
- Uses the agent's own retrieval as reference
- Catches: hallucinated details, unsupported claims, information not in source documents
- Based on the RAGAS faithfulness methodology (Shahul et al., 2023)

**Call 3: Factuality (Search-Verified)**

The judge receives the query and response, plus access to Glean's search tools. It independently searches company data to verify specific factual claims — names, numbers, dates, metrics — and cites its sources for each verification.

This answers: *"Are the specific facts actually true?"*

- Does NOT use eval guidance — always checks against current data
- The judge searches independently, not relying on what the agent found
- Catches: outdated information, fabricated specifics, imprecise numbers
- Most expensive (the judge does its own search), which is why it's optional

### The Seven Dimensions

| Dimension | Method | What It Measures |
|-----------|--------|-----------------|
| **Topical Coverage** | Coverage (Call 1) | Did the response address the expected themes? |
| **Response Quality** | Coverage (Call 1) | Is the output well-structured, concise, and actionable? |
| **Groundedness** | Faithfulness (Call 2) | Are claims supported by the agent's retrieved documents? |
| **Hallucination Risk** | Faithfulness (Call 2) | Does the response assert specifics without source backing? |
| **Factual Accuracy** | Factuality (Call 3) | Are specific claims true according to current data? |
| **Latency** | Direct measurement | End-to-end response time |
| **Tool Calls** | Direct measurement | Number of tools invoked during execution |

### Categorical Scoring

All judge-scored dimensions use categorical scales rather than numeric 1-10 ratings:

**full → substantial → partial → minimal → failure**

Research from I/O psychology (situational judgment test design) shows that forcing evaluators into defined categories — each with a specific behavioral anchor — produces scores that are 15% more reliable and 37% more valid than asking them to pick a number on a continuous scale. The judge can't default to "7 out of 10" — it has to commit to whether coverage is *full* or merely *substantial*, with clear criteria for each level.

### Multi-Judge Panels

Single LLM judges have systematic biases. Seer supports running evaluations through multiple models from different families — for example, Claude Opus 4.6 and GPT-5 — and aggregating scores via majority vote.

For categorical dimensions, the panel votes on the category. For binary dimensions (like hallucination risk), majority rules. Reasoning from all judges is preserved so you can see where they agreed and where they diverged.

Cross-family panels have complementary error profiles: where one model over-flags, another tends to be accurate, and vice versa. The ensemble is more reliable than any single judge.

### Evaluation Modes

| Mode | Judge Calls | Best For |
|------|-------------|----------|
| **Quick** | Coverage + Faithfulness (2 calls/case) | Iterating on agent prompts, routine checks, A/B testing |
| **Deep** | Quick + Factuality (3 calls/case) | Pre-deployment validation, high-stakes agents |
| **Custom** | Pick individual dimensions | Targeted investigation of specific quality concerns |

Quick mode gives you a reliable quality signal in ~30 seconds per case. Deep mode adds independent fact-checking at the cost of an additional search-grounded judge call. Custom mode lets you focus on exactly what you need.

---

## The Evaluation Pyramid

These methods layer naturally into a pyramid — each level trades off precision for temporal robustness:

```
                    △
                   / \        Factuality
                  /   \       Search-verified, always current
                 /     \      Catches: wrong facts
                /-------\
               /         \    Coverage
              /           \   Reference-based, theme-stable
             /             \  Catches: missed topics
            /---------------\
           /                 \  Faithfulness
          /                   \ Reference-free, never decays
         /                     \Catches: hallucination, unsupported claims
        /───────────────────────\
       /                         \ Direct Metrics
      /                           \Latency, tool calls — always accurate
     /─────────────────────────────\
```

The base never decays. The middle decays slowly (themes are stable). The top is always current (searches live data). Together, they give you a multi-dimensional view of agent quality that holds up over time.

---

## Key References

| Source | What It Contributes |
|--------|-------------------|
| FreshQA (Vu et al., 2023) | Question volatility taxonomy — why static answers decay |
| StreamingQA (Liska et al., 2022) | Answer validity windows — formalizing when tests expire |
| RAGAS (Shahul et al., 2023) | Reference-free faithfulness — evaluating without ground truth |
| G-Eval (Liu et al., 2023) | Chain-of-thought scoring — reason first, score second |
| GER-Eval (Siro et al., 2025) | Judge unreliability for factual domains — why search tools matter |
| Verga et al. (2024) | Multi-judge panels — ensemble reliability over single judges |
| Cavanagh (2026) | Categorical scoring — I/O psychology meets LLM evaluation |
| MT-Bench (Zheng et al., 2023) | Pointwise scoring with anchored rubrics, bias documentation |

---

*Seer is an evaluation framework for Glean agents. It combines research-backed evaluation methodology with Glean's search and company tools to provide reliable, decay-resistant quality measurement for enterprise AI agents.*
