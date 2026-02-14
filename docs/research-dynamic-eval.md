# Research: Evaluating AI Agents on Dynamic/Live Data

## The Problem

An enterprise AI agent searches live data (CRM records, documents, meetings, Slack threads) to answer questions. Evaluation QA pairs are authored at time T with expected answers grounded in the data at time T. At time T+1, underlying data has changed: new documents created, records updated, meetings held, threads continued. Running the same QA pairs at T+1 produces **false negatives** -- the agent's answer is correct for the *current* data but doesn't match the stale expected answer.

This is not a failure of the agent. It is a failure of the evaluation harness.

```
Time T:   Q: "Who is the PM for Project X?"  Expected: "Alice"     (correct at T)
Time T+1: Q: "Who is the PM for Project X?"  Expected: "Alice"     (stale -- Bob took over)
          Agent answers: "Bob"               Eval scores: FAIL     (false negative)
```

---

## 1. Has This Problem Been Formally Identified?

### 1.1 Academic and Research Literature

**Yes, but under several different names.** The problem sits at the intersection of multiple recognized research threads:

**Benchmark Contamination and Decay.** The ML evaluation community has extensively studied how static benchmarks degrade over time. This is well-documented for LLM benchmarks (MMLU, HellaSwag, etc.) where the concern is model training data contamination rather than ground-truth drift. But the structural insight is the same: **a fixed test set's validity decays as the world changes**.

Key works:
- **"Dynabench" (Kiela et al., 2021)** -- Facebook AI's dynamic benchmarking platform. Core thesis: static benchmarks saturate and become unreliable over time. Proposes human-in-the-loop adversarial data collection where benchmarks are continuously refreshed. Published in NeurIPS 2021.
- **"LiveBench" (White et al., 2024)** -- A benchmark designed to be contamination-free by continuously updating questions from recent information sources (math competitions, recent papers, datasets). Directly addresses temporal validity of evaluations.
- **"Chatbot Arena" (Zheng et al., 2023)** -- LMSYS's approach uses live human preference voting rather than static expected answers, sidestepping the ground-truth staleness problem entirely through pairwise comparison.
- **"HELM" (Liang et al., 2022)** -- Stanford's Holistic Evaluation of Language Models. While focused on static benchmarks, it introduced the concept of **scenario-based evaluation** that separates what you're measuring from how you're measuring it, enabling evaluation evolution.

**Temporal Knowledge and Freshness in QA.** Several papers address the problem of evaluating systems that must reason over time-varying knowledge:
- **"Time-Sensitive Question Answering" (Chen et al., 2021)** -- Introduced TimeQA, a dataset where answers change depending on the temporal context. Directly models the problem of questions whose correct answers shift over time.
- **"StreamingQA" (Liska et al., 2022, DeepMind)** -- A benchmark for evaluating models on questions derived from news articles, where answers are explicitly tied to temporal windows. Questions have **validity periods** after which the expected answer may no longer be correct.
- **"FreshQA" (Vu et al., 2023)** -- Google Research's benchmark explicitly designed to test whether LLMs can handle questions whose answers change over time ("fast-changing" questions). Introduced a taxonomy: never-changing, slow-changing, fast-changing, and false-premise questions.
- **"TemporalWiki" (Jang et al., 2022)** -- Tracks how Wikipedia knowledge evolves and evaluates whether language models can keep up with changing facts.

**RAG-Specific Evaluation Over Changing Corpora.** This is where the research is thinnest relative to the importance of the problem:
- The RAGAS framework (Shahul Es et al., 2023) introduced reference-free metrics (Faithfulness, Context Relevancy) that evaluate against retrieved context rather than static ground truth -- a partial solution.
- **"ARES" (Saad-Falcon et al., 2023)** -- Automated RAG Evaluation System. Uses prediction-powered inference to evaluate RAG systems with minimal human annotation, and explicitly addresses the cost of maintaining ground-truth annotations.

### 1.2 The Gap

Despite these threads, **no single paper or framework has cleanly formalized the specific problem of "eval set decay for enterprise RAG agents operating on live organizational data."** The academic literature focuses on:
- World knowledge that changes (FreshQA, TimeQA) -- public facts
- Benchmark contamination -- training data leakage
- Dynamic adversarial benchmarking -- keeping benchmarks challenging

The **enterprise-specific variant** is distinct because:
1. The corpus is private and changes unpredictably (a Slack thread, a CRM update, a new doc)
2. Changes are high-frequency and fine-grained (not monthly Wikipedia edits, but daily operational changes)
3. The "correct answer" is permission-scoped (different users may correctly get different answers)
4. There is no public ground truth to regenerate from
5. The evaluation must be automated (no crowd-sourced annotation)

This is an **open problem** that practitioners are solving ad-hoc without a shared vocabulary or framework.

### 1.3 Proposed Terminology

The problem needs a name. Candidates from the literature and practitioner discourse:

| Term | Source/Usage | Fit |
|------|-------------|-----|
| **Eval Set Decay** | Practitioner term | Good -- captures the degradation over time |
| **Temporal Evaluation Drift** | Not widely used | Good -- precise but academic |
| **Ground Truth Staleness** | ML ops discourse | Good -- intuitive |
| **Benchmark Rot** | Informal | Vivid but imprecise |
| **Dynamic Evaluation Gap** | Novel | Describes the gap between static evals and dynamic systems |
| **Answer Validity Window** | StreamingQA-adjacent | Technical -- useful for implementation |

**Recommended:** "Eval decay" for the general phenomenon, "answer validity window" for the implementation concept.

---

## 2. Proposed Solutions (Literature + Practice)

### 2.1 Reference-Free Evaluation (Judge Against Retrieved Context, Not Static Answers)

**The most practical and widely-adopted partial solution.**

Instead of comparing the agent's answer to a static expected answer, evaluate whether the answer is faithful to what the agent actually retrieved.

**RAGAS Metrics (Shahul Es et al., 2023):**
- **Faithfulness:** Is every claim in the answer supported by the retrieved context? Does not require ground truth.
- **Context Relevancy:** Did the retrieval step return relevant documents? Does not require ground truth.
- **Answer Relevancy:** Is the answer relevant to the question? Does not require ground truth.
- **Context Precision / Recall:** Did retrieval find the right documents? Requires ground truth for "right documents."

```
Reference-free evaluation flow:
  Question --> Agent --> (Retrieved Context, Generated Answer)
  Judge evaluates: Answer faithful to Context? Context relevant to Question?
  No static expected answer needed.
```

**Strengths:**
- Immune to eval decay (no static ground truth to go stale)
- Catches hallucination (answer claims not supported by context)
- Catches retrieval failures (irrelevant context)

**Weaknesses:**
- Cannot catch **correct retrieval of wrong documents** (agent faithfully summarizes an outdated doc)
- Cannot catch **systematic retrieval gaps** (agent consistently misses a category of documents)
- Measures process fidelity, not outcome correctness
- A perfectly faithful answer to irrelevant context scores well on faithfulness but is still wrong

**Framework Support:**
- RAGAS: `Faithfulness()`, `ContextRelevance()`, `ResponseRelevancy()` -- all reference-free
- Braintrust Autoevals: `Faithfulness` scorer from RAGAS integration
- LangSmith: Custom evaluators can be defined without `reference_outputs`

### 2.2 LLM-as-Judge with Semantic Comparison (Not Exact Match)

Use an LLM judge to compare agent output to expected output with tolerance for semantic equivalence and additional correct information.

**LangSmith Pattern:**
```python
correctness_instructions = """
Grade the student answers based ONLY on their factual accuracy
relative to the ground truth answer.
It is OK if the student answer contains more information than the
ground truth answer, as long as it is factually accurate relative
to the ground truth answer.
"""
```

**Braintrust `Factuality` Scorer:**
- Compares output to expected with LLM reasoning
- Returns score [0,1] with rationale
- Handles paraphrasing, additional detail, partial overlap

**This helps with eval decay but doesn't solve it:**
- Tolerates the agent adding new (correct) information not in the expected answer
- Still fails when the expected answer is factually outdated (the agent says "Bob" and expected says "Alice" -- judge marks incorrect even though "Bob" is now correct)

### 2.3 Time-Stamped Eval Sets with Expiration / Validity Windows

Attach metadata to each QA pair indicating when the expected answer was valid and when it should be re-verified.

```json
{
  "question": "Who is the PM for Project X?",
  "expected_answer": "Alice",
  "created_at": "2026-01-15T00:00:00Z",
  "valid_until": "2026-02-15T00:00:00Z",
  "volatility": "high",
  "data_sources": ["jira:PROJECT-X", "slack:#project-x"],
  "requires_refresh": true
}
```

**StreamingQA's approach:**
- Questions are derived from timestamped news articles
- Each question has a **knowledge cutoff** -- the date after which the expected answer is no longer guaranteed valid
- Evaluation only counts questions within their validity window

**Implementation for enterprise:**
- Tag each QA pair with `volatility: high | medium | low | static`
- High-volatility questions (people, status, metrics) expire quickly
- Low-volatility questions (policies, architecture, definitions) last longer
- Expired questions are either refreshed or excluded from scoring
- Track which data sources the answer depends on; when those sources change, flag for refresh

**Strengths:**
- Acknowledges reality that answers have shelf lives
- Enables meaningful scoring over time
- Prioritizes QA maintenance effort

**Weaknesses:**
- Requires manual volatility classification (or heuristics)
- Doesn't solve the refresh problem, just identifies when refresh is needed
- Maintenance overhead for the eval set itself

### 2.4 Regenerate Expected Answers at Eval Time

Instead of maintaining static expected answers, regenerate them dynamically by querying the underlying data sources directly at eval time.

```
Eval-time regeneration flow:
  1. For each question, query the source-of-truth systems directly
  2. Generate a fresh expected answer from the current data
  3. Compare agent's answer to the freshly-generated expected answer
  4. Use LLM judge for semantic comparison
```

**Glean Internal Pattern -- "Offline Researcher":**
From the Glean Factual Similarity Proposal (Megha Jhunjhunwala, 2024):
> "Offline Researcher: implementing an offline researcher that can look at many more documents in the customer's corpus to find answers to questions. We can think of this as Research Mode on steroids with no constraints on cost/latency that runs offline."

This is essentially the "regenerate ground truth" approach -- use a more powerful (unconstrained) system to establish what the correct answer currently is, then evaluate the production system against it.

**Strengths:**
- Ground truth is always current
- Fully automated (no manual refresh)
- Can handle any corpus change

**Weaknesses:**
- Circular reasoning risk: if the regenerator uses the same retrieval pipeline, you're evaluating the system against itself
- Expensive (requires running a second, more thorough system for every eval question)
- The regenerator itself can be wrong -- who evaluates the evaluator?
- Doesn't catch systematic retrieval gaps that affect both systems

**Mitigation:** Use a fundamentally different retrieval strategy for the regenerator (e.g., exhaustive search vs. the agent's top-k retrieval).

### 2.5 Process Evaluation (Did It Do the Right Things?) vs. Output Evaluation (Did It Get the Right Answer?)

Evaluate the agent's **behavior** rather than its **output**. This is the approach taken by Glean's agent evaluation framework.

**Glean Internal Approach:**
From the Glean Agent Eval framework:
- **E2E Completeness Judge:** Evaluates whether the agent's response fully addresses the user's request, using workflow inputs and schema to understand the task
- **Step-wise Instruction Following:** Did each step in the agent's workflow follow its instructions?
- **Robustness:** Does the agent handle edge cases gracefully?

From the Autonomous Agents Evals Proposal (Sudhansh Peddabomma, 2025):
> "In the current eval system, we simply evaluate 'single-turn' queries... That limitation becomes an issue for autonomous agents since what previously were individual 'trackable' steps are now being converted to implicit model decisions."

**Process metrics immune to eval decay:**
- **Tool call accuracy:** Did the agent call the right tools/APIs?
- **Query quality:** Were the search queries well-formed and targeted?
- **Source selection:** Did it search in the right data sources?
- **Reasoning quality:** Was the chain-of-thought logical?
- **Convergence efficiency:** How many steps to reach an answer? (Glean measures this -- their code search eval showed 3.45 tool calls vs. Cursor's 9.97)

**Strengths:**
- Completely immune to ground-truth staleness
- Catches process failures that output evaluation misses
- Enables debugging (which step failed?)

**Weaknesses:**
- Process correctness doesn't guarantee output correctness
- Harder to define "correct process" than "correct answer"
- Requires detailed trace/step logging

### 2.6 Pairwise / Comparative Evaluation

Instead of judging whether an answer is correct in absolute terms, compare two systems (or two versions of the same system) and judge which is better.

**Chatbot Arena (LMSYS):**
- Human judges compare two model outputs side by side
- No ground truth needed -- just preference
- ELO rating system for relative ranking

**Glean's Pairwise Comparison LLM Judge (Karthik Rajkumar, 2025):**
- Uses ordered logit models to derive latent quality scores from pairwise LLM judgments
- Compares config A vs. config B on the same eval set
- Reports "win rate" against production baseline
- Robust confidence intervals through statistical modeling

```
Pairwise eval flow:
  Question --> System A --> Answer A
  Question --> System B --> Answer B
  Judge: "Which answer is better and why?"
  No expected answer needed.
```

**Strengths:**
- No ground truth needed
- Detects regressions between versions
- Statistical rigor through ranking models
- Natural fit for A/B testing and system tuning

**Weaknesses:**
- Cannot measure absolute quality (both could be wrong)
- Requires running multiple systems (expensive)
- Doesn't catch consistent errors present in all versions

### 2.7 Hybrid / Tiered Evaluation Architecture

The most robust approach combines multiple strategies in tiers.

```
Tier 1: Reference-Free (always runs, immune to decay)
  - Faithfulness: answer grounded in retrieved context?
  - Relevancy: answer addresses the question?
  - Format/completeness: structurally sound response?

Tier 2: Process Evaluation (always runs, immune to decay)
  - Right tools called?
  - Reasonable search queries?
  - Appropriate number of steps?

Tier 3: Reference-Based with Validity Windows (runs on non-expired QA pairs)
  - Semantic comparison to expected answer (LLM judge)
  - Factuality scoring
  - Only scored for QA pairs within their validity window

Tier 4: Comparative/Regression (runs on version changes)
  - Pairwise comparison against baseline
  - Win rate on uniform eval set

Tier 5: Human-in-the-Loop (periodic, high-value)
  - Expert review of flagged edge cases
  - Refresh of expired QA pairs
  - Discovery of new eval scenarios from production traffic
```

---

## 3. How Enterprise AI Evaluation Frameworks Handle This

### 3.1 RAGAS

**Approach:** Reference-free metrics as first-class citizens.

RAGAS pioneered the idea that you can evaluate RAG quality without ground-truth answers by using the retrieved context as the reference. Key metrics:

| Metric | Needs Ground Truth? | What It Measures |
|--------|-------------------|------------------|
| Faithfulness | No | Claims supported by context |
| Context Relevancy | No | Retrieved docs relevant to query |
| Response Relevancy | No | Answer addresses the question |
| Context Precision | Yes | Relevant docs ranked higher |
| Context Recall | Yes | All relevant docs retrieved |
| Factual Correctness | Yes | Answer matches ground truth |
| Answer Similarity | Yes | Semantic similarity to ground truth |

**RAGAS does not explicitly address temporal decay.** It assumes you use reference-free metrics when ground truth is unavailable or stale, but doesn't model answer validity windows or automated refresh.

### 3.2 LangSmith / LangChain

**Approach:** Flexible evaluator framework; bring your own judges.

LangSmith provides infrastructure for evaluation but is **evaluation-strategy-agnostic**:
- Custom evaluator functions (with or without `reference_outputs`)
- LLM-as-judge patterns with structured output
- Dataset versioning (you can version your eval sets, but no auto-expiration)
- Online evaluation (evaluate production traces in real-time)

**Relevant pattern -- Online Evaluation:**
LangSmith supports evaluating production runs in real-time, which sidesteps the static eval set problem:
- Hook evaluators to production traces
- Evaluate every Nth production query
- Use reference-free judges (faithfulness, relevancy)
- Human feedback loop for flagged responses

**No built-in temporal decay handling.**

### 3.3 Braintrust

**Approach:** Experiment-centric with built-in scoring.

- `Factuality` scorer: LLM-as-judge comparing output to expected with semantic tolerance
- RAGAS integration: Faithfulness, AnswerCorrectness, AnswerRelevancy, ContextEntityRecall
- Dataset management with versioning
- Experiment comparison (pairwise across runs)

**Braintrust's `Factuality` scorer partially addresses eval decay** by using LLM judgment rather than exact match, tolerating additional correct information in the output. But it still requires an expected answer and will score incorrectly when the expected answer is stale.

### 3.4 Glean Internal Patterns

From the internal documents reviewed, Glean's evaluation approach includes several relevant patterns:

**Eval Sets Mined from Production:**
- `AGENTS_UNIFORM`: uniform sample of recent workflow runs
- Eval sets are refreshed from production traffic, providing natural recency
- "Downvoted Assistant Queries Last 7 Days" -- rolling eval sets that auto-refresh

**LLM Judges (reference-free):**
- **Completeness Judge:** Does the response fully address the request? (No ground truth needed)
- **Instruction Following Judge:** Did the agent follow its instructions? (Process evaluation)
- **Groundedness Judge:** Is the response grounded in retrieved information? (Reference-free)
- **Robustness Judge:** Handles edge cases? (Reference-free)
- **Comment-Alignment Judge:** Does the response align with user feedback on bad answers? (User-referenced, not ground-truth-referenced)

**Factual Similarity (with ground truth):**
- Uses "factual similarity" between test answer and ground-truth answer
- Acknowledges the gap: ground truth is expensive to create and maintain
- Proposed "Offline Researcher" for automated ground-truth generation

**Pairwise Comparison:**
- Ordered logit model for pairwise LLM judge comparisons
- Win rate reporting against production baseline
- Used for system tuning and regression detection

**Notable gap identified internally:**
From "Reward Model for Offline Evaluation" (Xinyu Zhao, 2026):
> "These signals leave our offline eval stack fragmented and incomplete: each judge captures a narrow slice of quality, and none can serve as a robust primary metric across models and use cases."

---

## 4. Practical Patterns for Knowledge Work Agents

### 4.1 Pattern: The Evaluation Pyramid

For agents that answer questions over dynamic enterprise data, structure evaluation in layers:

```
                    /\
                   /  \      Human Review
                  /    \     (periodic, high-stakes QA pairs)
                 /------\
                /        \   Reference-Based Eval
               /          \  (validity-windowed, semantic judge)
              /------------\
             /              \ Process Eval
            /                \ (tool calls, search quality, reasoning)
           /------------------\
          /                    \ Reference-Free Eval
         /                      \ (faithfulness, relevancy, completeness)
        /________________________\
```

Each layer trades off between precision (can it catch all errors?) and temporal robustness (does it decay?). The base is immune to decay; the top is most precise but most fragile.

### 4.2 Pattern: Volatility-Aware Eval Sets

Classify every QA pair by how quickly its answer changes:

| Volatility | Example | Refresh Cadence | Strategy |
|-----------|---------|-----------------|----------|
| **Static** | "What does our PTO policy say about..." | Quarterly | Traditional reference-based |
| **Slow** | "Who leads the engineering org?" | Monthly | Reference-based + validity window |
| **Medium** | "What's the status of Project X?" | Weekly | Prefer reference-free; refresh weekly |
| **Fast** | "What did @alice say about the bug?" | Daily | Reference-free only; process eval |
| **Ephemeral** | "What's on the agenda for today's standup?" | Hours | Reference-free only; don't even try reference-based |

### 4.3 Pattern: Dual-System Ground Truth Regeneration

Use two fundamentally different retrieval strategies:

```
Production Agent (fast, constrained):
  - Top-k retrieval
  - Cost/latency optimized
  - Permission-scoped

Eval Oracle (thorough, unconstrained):
  - Exhaustive search
  - No latency constraints
  - Same permission scope
  - Different retrieval algorithm

Compare: Production answer vs. Oracle answer (with LLM judge)
```

The oracle is not ground truth -- it's a **reference signal** that's more likely to be correct. Disagreements are flagged for human review, not automatically scored as failures.

### 4.4 Pattern: Regression-First Evaluation

Instead of asking "is the answer correct?" (which requires ground truth), ask "is the answer worse than it was?" (which requires only a baseline).

1. Record production answers at time T as the baseline
2. After a system change, run the same questions at T+1
3. Use pairwise LLM judge: "Is the new answer better, same, or worse?"
4. Flag regressions for human review

This catches system-caused quality changes while being naturally immune to data-caused answer changes (both baseline and test reflect the same current data... unless the system change is deployed between runs).

**Limitation:** Requires re-running the baseline against current data, which is expensive.

### 4.5 Pattern: Production Feedback Loop

Use production user behavior as continuous ground truth:

```
Production Query --> Agent Answer --> User Action
                                      |
                                      v
                              Upvote? Downvote? Reformulate?
                              Click citation? Ignore answer?
                                      |
                                      v
                              Signal: answer quality
```

- **Upvoted answers** become provisional ground truth (validated by users)
- **Downvoted answers + user comments** become negative examples with explanation
- **Reformulated queries** signal answer inadequacy
- Rolling eval sets built from recent production interactions are naturally fresh

Glean already does this: "Downvoted Assistant Queries Last 7 Days" as an eval set.

### 4.6 Anti-Pattern: Static Golden Sets for Dynamic Data

The pattern to avoid:

1. Expert creates 200 QA pairs at project start
2. QA pairs are treated as permanent ground truth
3. Eval scores degrade over weeks/months
4. Team blames the agent for "getting worse"
5. Investigation reveals answers are actually better -- eval set is stale
6. Trust in evaluation is destroyed
7. Team stops running evals

**This is extremely common in enterprise AI deployments.** The antidote is explicitly building temporality into the evaluation design from day one.

---

## 5. Recommendations for Seer

Based on this research, a practical evaluation framework for an agent operating on dynamic enterprise data should:

1. **Lead with reference-free metrics.** Faithfulness and relevancy should be the primary automated quality signals. They never go stale.

2. **Add process evaluation.** Track tool calls, search queries, and reasoning quality. These measure capability independent of data state.

3. **Use reference-based eval selectively.** Only for static/slow-volatility questions. Tag every QA pair with a validity window. Auto-exclude expired pairs from scoring.

4. **Implement regression detection.** Pairwise comparison against a recent baseline catches system-caused degradation without requiring ground truth.

5. **Build eval sets from production.** Use upvoted/downvoted production interactions as a rolling, naturally-fresh eval set. Complement with curated QA pairs for coverage.

6. **Separate "data changed" from "system regressed."** When an eval score drops, the first question should be: "Did the underlying data change?" not "Did the system break?"

7. **Track data source freshness.** If an eval question depends on a specific document and that document was updated after the QA pair was created, flag it.

---

## 6. Key References

### Academic / Research
- Kiela et al. (2021). "Dynabench: Rethinking Benchmarking in NLP." NeurIPS 2021.
- Chen et al. (2021). "A Dataset for Answering Time-Sensitive Questions." NeurIPS 2021 (TimeQA).
- Liska et al. (2022). "StreamingQA: A Benchmark for Adaptation to New Knowledge over Time." DeepMind.
- Liang et al. (2022). "Holistic Evaluation of Language Models." Stanford CRFM (HELM).
- Jang et al. (2022). "TemporalWiki: A Lifelong Benchmark for Training and Evaluating Ever-Evolving Language Models."
- Shahul Es et al. (2023). "RAGAS: Automated Evaluation of Retrieval Augmented Generation." arXiv.
- Zheng et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." NeurIPS 2023.
- Saad-Falcon et al. (2023). "ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems."
- Vu et al. (2023). "FreshQA: Natural Questions Require Fresh Answers." Google Research.
- White et al. (2024). "LiveBench: A Challenging, Contamination-Free LLM Benchmark."

### Frameworks and Tools
- RAGAS: https://docs.ragas.io -- Reference-free RAG evaluation metrics
- LangSmith: https://docs.smith.langchain.com/evaluation -- Flexible evaluation infrastructure
- Braintrust: https://www.braintrust.dev -- Experiment-centric LLM evaluation with Factuality scorer and RAGAS integration

### Glean Internal
- "Agent Eval" (Lauren Zhu, 2025) -- Agent evaluation framework with evalsets and judges
- "GleanChat Quality Evaluation Playbook" (Eddie Zhou, 2023-present) -- Evaluation process and judge catalog
- "Autonomous Agents: Evals Proposal" (Sudhansh Peddabomma, 2025) -- Adapting evaluation for autonomous agents
- "Factual Similarity Proposal" (Megha Jhunjhunwala, 2024) -- Ground truth generation and factual evaluation
- "Pairwise Comparison LLM Judge for Deep Research" (Karthik Rajkumar, 2025) -- Statistical pairwise evaluation
- "Reward Model for Offline Evaluation" (Xinyu Zhao, 2026) -- Unified quality metric proposal
- "FY27 Glean Agent Product Strategy" (Rohan Vora, 2026) -- Agent evals as product feature roadmap

---

*This problem is real, under-formalized, and under-solved. The enterprise AI community is converging on reference-free evaluation as the pragmatic default, but no one has built the complete framework yet. There's an opportunity to define it.*

-- Axon | 2026-02-13
