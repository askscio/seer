# Evaluating Glean Agents: From Vibes to Evidence

**GKO 2026 · 20 minutes**

*The goal: every AIOM leaves with a shared mental model for agent evaluation and a method they can use with a customer this week.*

---

## Slide 1: Title

**Evaluating Glean Agents**
From Vibes to Evidence

Kenneth · AI Outcomes

---

## Slide 2: The Vibes Problem

You launched an agent. The customer asks: *"Is it working?"*

Your honest answer is probably one of:
- "Usage looks good"
- "Nobody's complained"
- "The demo went well"
- "I think so?"

None of these are evidence. They're vibes.

**Vibes don't survive exec reviews.** When a VP asks "how do we know this agent is accurate?" — you need a better answer than "people seem to like it."

This session: a shared mental model for evaluation, and a practical method for getting real answers.

> **Speaker notes:** This is the hook. 30 seconds. Everyone in the room has felt this. Move quickly.

---

## Slide 3: Where Agent Evals Sit

Not all evals are the same. They live at different levels of the stack:

```
┌─────────────────────────────────────────┐
│  Business-level                         │
│  "Does this agent move outcomes that    │
│   matter to the customer?"              │
├─────────────────────────────────────────┤
│  Agent-level                            │
│  "Does this end-to-end workflow         │
│   actually complete the user's task?"   │
├─────────────────────────────────────────┤
│  Feature / tool-level                   │
│  "Does search / connector X            │
│   return the right results?"            │
├─────────────────────────────────────────┤
│  Model-level                            │
│  "How does the LLM perform on          │
│   reasoning, coding, etc.?"            │
└─────────────────────────────────────────┘
```

Model benchmarks (MMLU, HumanEval) don't tell you if a Glean agent works for a customer's use case. Feature tests don't tell you if the end-to-end experience is good. We need **agent-level and business-level evaluation** — and that's what we're least equipped to do today.

> **Speaker notes:** Quick orientation — 45 seconds. The point is: what we're talking about is different from model benchmarks. We're evaluating whether agents complete real tasks for real users, not whether the underlying LLM can do math. ~1 minute.

---

## Slide 4: Why This Is Actually Hard

Three reasons enterprise agent eval is different from chatbot eval:

**1. The right answer keeps changing.**
Your agent searches live company data — Salesforce, Gong, Google Drive, Confluence. When a deal closes, a doc updates, or a stakeholder changes, the "correct" answer changes too. A test you wrote last month might fail today — not because the agent got worse, but because the data moved.

**2. "Correct" isn't one thing.**
A response can cover the right topics but hallucinate a number. Or be factually perfect but miss half of what was asked. Or find the right documents but present them in an unusable wall of text. You need to measure multiple dimensions, not just "right or wrong."

**3. You can't Google the answer.**
For public knowledge, you can verify easily. For enterprise knowledge — "What's the renewal timeline for this account?" — the only way to check is to search the same systems the agent searches. Generic AI can't judge domain-specific correctness.

> **Speaker notes:** ~2 minutes. These three reasons should land as "oh, that's why this feels hard." If you have a concrete example from your own accounts, use it.

---

## Slide 5: The Eval Decay Problem

This is the single most important concept in this talk.

```
January:
  Q: "Who is the executive sponsor for Acme Corp?"
  Expected answer: "Sarah Chen, VP of Engineering"
  Agent says: "Sarah Chen" → ✅ PASS

March:
  Same expected answer: "Sarah Chen, VP of Engineering"  ← stale
  Agent says: "James Liu, CTO"                          ← correct
  Score: ❌ FAIL (false negative)
```

The agent got *better*. But the test says it failed.

This is called **eval decay** — your tests degrade over time as the underlying data changes. If you build a test set of 50 expected answers today, half will be wrong within a month.

The research backs this up: FreshQA (Google, 2023) showed that questions about changing facts need fundamentally different evaluation methods. StreamingQA (DeepMind, 2022) formalized "answer validity windows" — the period after which a test case can't be trusted.

**The fix:** Don't test against exact answers. Test against **themes.**

> **Speaker notes:** This is the "aha" moment. Pause after the example. Let people feel the problem before giving the solution. ~2 minutes.

---

## Slide 6: Themes, Not Answers

Instead of writing what the answer *should say*, write what it *should cover*.

**Example: IT Help Desk Agent**

| Traditional Expected Answer | What Changed |
|---|---|
| *"Go to okta.company.com/reset, click 'Forgot Password', enter your corporate email, and follow the MFA steps. Contact IT in #it-helpdesk."* | Company migrated from Okta to Entra. Slack channel renamed to #tech-support. |

The agent correctly tells users to go to Entra and use #tech-support. The eval scores it **FAIL** — because the expected answer says Okta.

**Eval guidance (themes):** *"Should identify the current identity provider, link to self-service reset, describe verification steps, and provide an escalation path."*

✓ Still valid. The themes haven't changed — only the specific tools have.

**The pattern: facts change, themes don't.** That's why we test themes.

> **Speaker notes:** Walk through the example slowly. The contrast between "expected answer is now wrong" and "eval guidance still works" is the key visual. ~1.5 minutes.

---

## Slide 7: Common Eval Approaches

How do teams typically evaluate AI outputs?

| Approach | How It Works | Strengths | Limitations |
|----------|-------------|-----------|-------------|
| **Human review** | People read outputs and score them | Gold standard for quality | Doesn't scale. Expensive. Subjective. |
| **Exact match / keyword** | Compare output to expected string | Simple, fast | Brittle. Fails on paraphrasing. Fails on dynamic data. |
| **LLM-as-a-judge** | Another AI scores the output against a rubric | Scales. Can apply rich rubrics. | Has its own biases (next slide). Can't verify enterprise facts. |
| **A/B testing** | Show users two versions, measure preference | Captures real user signal | Requires traffic. Slow feedback loop. Hard to set up for agents. |
| **Usage metrics** | Track adoption, thumbs, repeat use | Always available. No setup. | Tells you *what* happened, not *why*. |

No single approach is sufficient. The best eval strategies **combine** methods — automated scoring for scale, human review for calibration, and usage metrics for real-world signal.

> **Speaker notes:** ~1.5 minutes. Don't dwell on each cell — the table is a reference. The takeaway: you need a mix, and the mix depends on what you're trying to learn. Most AIOMs today are only doing the bottom row (usage metrics). We need to add the middle rows.

---

## Slide 8: LLM-as-a-Judge — Powerful but Flawed

Using an LLM to evaluate agent outputs is the most scalable approach. But it has real failure modes you need to know about:

**Verbosity bias** — LLM judges score longer responses 10-20% higher, even when the extra length adds no value. A concise, correct answer gets outscored by a verbose, padded one.

**Self-enhancement bias** — Models tend to prefer outputs that sound like their own style. A GPT judge rates GPT-style outputs higher. A Claude judge prefers Claude-style outputs.

**Factual blind spots** — This is the big one for us. An LLM judge will confidently score whether "TCV is $5.9M" is correct — but it has no idea. It doesn't know your company's data. Without access to the actual source systems (Salesforce, Google Drive, etc.), it's guessing.

**Central tendency** — Judges cluster scores around 6-8 out of 10. Everything looks "pretty good." Use categories (full / partial / missing) instead of numbers — it forces the judge to commit.

**Mitigations:**
- Use **categories, not numbers** (forces the judge to commit to a bucket)
- Give the judge **search tool access** so it can verify facts
- Use **multiple judges** from different model families to reduce bias
- **Calibrate** with human-reviewed examples

> **Speaker notes:** ~2 minutes. The factual blind spots point is the most important for our context — Glean agents answer questions about enterprise data that no LLM has seen in training. A judge without search access is just making stuff up about whether the facts are right. This is why the judge agent trick (coming up) uses Glean search.

---

## Slide 9: What to Measure

You don't need to measure everything. Three questions cover 90% of what matters:

| Dimension | Question | How to Check |
|-----------|----------|-------------|
| **Coverage** | Did it address the right topics? | Compare against your eval guidance (themes) |
| **Faithfulness** | Did it make anything up? | Check if claims are supported by the sources the agent found |
| **Quality** | Is it useful? | Is it structured, concise, and actionable? |

**Coverage** decays slowly (themes are stable).
**Faithfulness** never decays (checks against the agent's own retrieval, not your test case).
**Quality** never decays (structural judgment, not factual).

This is why the combination works — even when coverage guidance gets stale, faithfulness and quality still give you reliable signal.

> **Speaker notes:** ~1.5 minutes. Deliberately simplified. The academic frameworks have more dimensions, but these three are what an AIOM needs. Coverage = "did it answer what was asked?", Faithfulness = "did it make stuff up?", Quality = "could someone act on this?"

---

## Slide 10: Metrics You Already Have

Before building any test set, you're already sitting on useful signal:

| Metric | Where to Find It | What It Tells You |
|--------|-------------------|-------------------|
| **WAU / adoption by team** | Glean analytics | Who's using the agent and who isn't |
| **Thumbs up / down** | Agent analytics | Broad user satisfaction signal |
| **Thumbs-down comments** | Agent analytics | *Why* users are unhappy — gold for building test cases |
| **Repeat use** | Usage logs | Are people coming back? (Retention > adoption) |
| **Latency** | Agent analytics | Is the agent too slow for the use case? |
| **Escalation / handoff rates** | Support metrics | Is the agent deflecting or creating more work? |

These metrics tell you *what's happening* — but not *why*. An agent can have high usage and still hallucinate 20% of the time. That's where structured eval comes in.

**Pro tip:** Thumbs-down responses are the best raw material for building your first test set. They're real queries where the agent failed, from real users, on real data.

> **Speaker notes:** ~1 minute. This is the "you're not starting from zero" moment. Emphasize thumbs-down as test case source — it's immediately actionable.

---

## Slide 11: The Method

Here's a method you can run with any customer, this week, with no code:

```
Step 1: Build a test set
        10-20 real questions from tickets, FAQs, thumbs-down
              ↓
Step 2: Write eval guidance
        Themes, not answers. 2-4 sentences each.
              ↓
Step 3: Run the agent, capture outputs
        Paste into a spreadsheet or use a judge agent
              ↓
Step 4: Score: Coverage / Faithfulness / Quality
        Full, Partial, Missing — not 1-10
              ↓
Step 5: Review with the customer
        Share what's strong, what's weak, what to change
```

> **Speaker notes:** Show the full flow. 30 seconds on this slide — it's an overview. The next few slides walk through the practical details.

---

## Slide 12: Building the Test Set + Eval Guidance

**Where to find test cases:**
- Support tickets / IT requests (most common questions)
- Thumbs-down responses (things the agent got wrong)
- Customer FAQs and enablement session Q&A
- Power user suggestions

**Include variety:** easy cases, hard cases, edge cases (misspellings, abbreviations), and at least one "should say I don't know" case.

**Writing eval guidance:**
```
Query: "What's the status of Project Mercury?"

Eval Guidance:
"Should cover current phase, key blockers or risks,
recent activity, team leads involved, and next steps.
Should reference project docs, not general knowledge."
```

2-4 sentences per case. Focus on topics and themes. Note what would make a response *wrong*. You don't need 100 cases — 10-20 well-chosen ones that cover the agent's primary use cases will tell you more than 100 random ones.

> **Speaker notes:** ~2 minutes. Emphasize: building the test set takes 30 minutes if you know the account. Eval guidance is 2-4 sentences, not a full answer. You're writing what topics should be covered, not the words to use.

---

## Slide 13: Scoring + The Judge Agent Trick

**Manual scoring (start here):**

For each response, answer three questions:

| Coverage | Faithfulness | Quality |
|----------|-------------|---------|
| Full / Partial / Missing | Any unsupported claims? Yes / No | Good / OK / Poor |

Why **categories, not numbers**: picking "full vs partial" is easier and more reliable than picking "7 out of 10." Research shows 15% higher reliability with categorical scales.

**Scale it up: build a judge agent in Glean.**

Create a Glean agent in Agent Builder with:
- **Input fields:** `Query`, `Eval Guidance`, `Agent Response`
- **Instructions:** Score the response on coverage, flag unsupported claims, rate quality. Explain your reasoning.
- **Tools enabled:** Company search (so it can verify facts against current data)

Now you can pass each response through the judge agent and get structured scores with reasoning — at scale, without manual review.

**The judge agent uses Glean's own search** to verify claims. It's not guessing whether "TCV is $5.9M" is correct — it's checking Salesforce.

> **Speaker notes:** ~2 minutes. The judge agent is the practical innovation. If you can demo it — even a screenshot of the Agent Builder setup — that's powerful. This is what separates "we should do evals" from "here's how we actually do evals."

---

## Slide 14: Review with the Customer

The eval isn't complete until you review it with the customer.

**Who's in the room:**
- Agent builder / admin
- Business stakeholder
- You (AIOM — facilitation + interpretation)

**What to share:**
- **Coverage:** "Out of 15 test cases, the agent fully covered the right topics in 10, partially in 3, and missed key themes in 2. Here are the 2 it missed and why."
- **Faithfulness:** "We flagged 3 responses where the agent stated specific details we couldn't verify in the source documents."
- **Quality:** "Most responses were well-structured. Two were too verbose — raw doc excerpts instead of synthesis."

**What to decide:**
- Which gaps matter most? (Not all failures are equal)
- What to change? (Agent instructions, tools, data sources)
- When to re-test? (Run the same test set after changes)

**Cadence:** Monthly early on, quarterly once stable.

> **Speaker notes:** ~1.5 minutes. This is the customer motion. The eval gives you a structured review agenda. You're not guessing what to talk about.

---

## Slide 15: Talking to Customers About Evals

**With exec sponsors:**
- Lead with outcomes: *"We tested the agent on your team's 20 most common questions. It fully answered 80% and partially answered 15%."*
- Frame as de-risking: *"Before we roll out to 500 more users, we've verified it handles the top use cases."*
- Position as a process: *"We have a baseline. Each month we measure again and you'll see the trajectory."*

**With agent builders / technical leads:**
- Share specific failures: *"Here are the 3 cases where it missed — the agent isn't searching Confluence, only Google Drive."*
- Talk dimensions: *"Coverage is strong but we're seeing faithfulness issues with financial data."*
- Co-own improvement: *"Can we adjust instructions to always cite sources for numbers?"*

**What resonates everywhere:**
- *"We're not guessing. We tested it."*
- *"Here's exactly where it's strong and where it needs work."*
- *"We can measure the improvement."*

> **Speaker notes:** ~1.5 minutes. This makes AIOMs look credible and rigorous. You're not reporting vibes — you're presenting evidence.

---

## Slide 16: Where Things Are Headed

Agent evaluation is moving fast across the industry:

**From chatbot scoring → task completion**
The question is shifting from "did it say something reasonable?" to "did it complete the user's task end-to-end?" — which is exactly where Glean agents live.

**From static benchmarks → live evaluation**
Teams are building eval sets from real production traffic, not imagined scenarios. Thumbs-down responses, support escalations, and sampled agent runs are the raw material.

**From single judges → ensembles**
Cross-family judge panels (Claude + GPT + Gemini) with majority vote — because single judges have systematic blind spots.

**Eval tooling is becoming a product category**
Glean is investing here. The manual methods we covered today are the foundation — and they'll translate directly to the automated tooling as it matures.

**The skills you build now doing manual evals — writing good test cases, defining eval guidance, interpreting results with customers — are the same skills that make automated eval tools useful.**

> **Speaker notes:** ~1 minute. Forward-looking energy. The point: this isn't a temporary workaround. Learning to think about eval now makes you better at it when the tools arrive.

---

## Slide 17: What Good Looks Like

An AIOM who's doing evals well:

✓ Has a **test set of 10-20 cases** for each priority agent
✓ Uses **eval guidance (themes)** instead of expected answers
✓ Runs evals **after every significant agent change**
✓ Reviews results **with the customer** monthly
✓ Tracks **trends over time** — are scores improving?
✓ Combines eval results **with usage and sentiment metrics**

You don't need a tool. You need a spreadsheet, a method, and 2 hours.

> **Speaker notes:** Closing slide. 30 seconds. The message: this is achievable, starting this week.

---

## Appendix: Resources

**Research:**
- FreshQA (Vu et al., 2023) — Why static answers decay over time
- StreamingQA (Liska et al., 2022) — Answer validity windows
- RAGAS (Shahul et al., 2023) — Reference-free faithfulness evaluation
- G-Eval (Liu et al., 2023) — Chain-of-thought scoring
- GER-Eval (Siro et al., 2025) — Why judges need search tools for factual domains
- Verga et al. (2024) — Multi-judge ensemble reliability
- Cavanagh (2026) — Categorical scoring from I/O psychology

**Internal:**
- [Evaluating Agents on Live Data — One Pager](https://docs.google.com/document/d/1heJh_0g9GxAj48bOGELr-OlnTdT6d-41cZ4ICo85mBM/edit?usp=sharing)

---

## Timing Guide

| Section | Slides | Time |
|---------|--------|------|
| The Vibes Problem + Eval Stack | 1-3 | 2 min |
| Why It's Hard + Eval Decay | 4-5 | 4 min |
| Themes, Not Answers | 6 | 1.5 min |
| Common Approaches + Judge Pitfalls | 7-8 | 3 min |
| What to Measure + Existing Metrics | 9-10 | 2.5 min |
| The Method (full walkthrough) | 11-13 | 4 min |
| Customer Reviews + Conversations | 14-15 | 2 min |
| Where Things Are Headed + Close | 16-17 | 1 min |
| **Total** | **17 slides** | **~20 min** |
