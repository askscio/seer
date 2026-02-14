# LLM-as-Judge Best Practices for Knowledge Work Agents

**A practical guide to evaluating search, retrieval, synthesis, and Q&A agents using LLM judges.**

This guide distills research from G-Eval, MT-Bench/Chatbot Arena, RAGAS, and applied evaluation practice into actionable patterns for building reliable LLM-as-judge systems. Written specifically for knowledge work agent evaluation -- the domain Seer operates in.

---

## Table of Contents

1. [Judge Prompt Engineering](#1-judge-prompt-engineering)
2. [Knowledge Work Evaluation Patterns](#2-knowledge-work-evaluation-patterns)
3. [Bias Mitigation](#3-bias-mitigation)
4. [Multi-Criteria Scoring](#4-multi-criteria-scoring)
5. [Notable Frameworks and Papers](#5-notable-frameworks-and-papers)
6. [Prompt Templates](#6-prompt-templates)

---

## 1. Judge Prompt Engineering

### 1.1 Structural Anatomy of a Judge Prompt

Every judge prompt has five components. Missing any one of them degrades reliability:

```
[ROLE]        → Who the judge is and what expertise they bring
[TASK]        → What they are evaluating and why
[RUBRIC]      → Concrete scoring criteria with anchored examples
[MATERIAL]    → The query, response, and optionally a reference answer
[FORMAT]      → Exact output structure for parsing
```

**Key principle:** The judge prompt is the single highest-leverage point in the entire eval pipeline. A vague rubric produces noise regardless of how good the judge model is.

### 1.2 Chain-of-Thought vs Direct Scoring

**The research is clear: chain-of-thought (CoT) judging outperforms direct scoring.**

G-Eval (Liu et al., 2023) demonstrated that asking the judge to generate evaluation steps before scoring improves correlation with human judgments by 10-20% across coherence, consistency, fluency, and relevance dimensions.

Three approaches, ranked by reliability:

| Approach | How It Works | When To Use |
|----------|-------------|-------------|
| **CoT-then-score** | Judge reasons first, then scores | Default. Best reliability. |
| **Score-then-justify** | Score first, then explain | Faster parsing, but reasoning anchors to premature score |
| **Direct score** | Score only, no reasoning | Only for binary/trivial criteria at scale |

**CoT-then-score implementation:**

```
REASONING: [Your analysis of the response against each rubric element]
SCORE: [number]
```

Not:

```
SCORE: [number]
REASONING: [explanation]
```

The order matters. When reasoning comes first, the model commits to an analytical position before quantifying it. When the score comes first, the reasoning becomes post-hoc justification.

**G-Eval's approach:** Generate evaluation steps as part of the CoT, then use probability-weighted scoring across the generated tokens. For practical implementations (where you don't have access to token probabilities), asking for structured reasoning before the score captures most of the benefit.

### 1.3 Rubric Design That Reduces Ambiguity

**Problem:** "Rate quality from 1-10" is meaningless. Every evaluator has a different mental model of what 7 means.

**Solution:** Anchor every score level to observable, concrete behaviors.

#### Pattern: Behavioral Anchoring

Bad rubric:
```
Score 1-3: Poor quality
Score 4-6: Average quality
Score 7-9: Good quality
Score 10: Excellent quality
```

Good rubric:
```
Score 9-10: Response directly answers the query with specific, verifiable claims.
           All claims are traceable to cited sources. No hallucinated details.
           Covers all aspects the user would need. Could be used as-is.
Score 7-8:  Response answers the query correctly. Most claims are grounded.
           May have minor gaps (e.g., missing one relevant source) or
           include one unsupported but plausible detail. Usable with light editing.
Score 5-6:  Response is partially correct. Some claims are grounded, others are
           vague or unsupported. Missing at least one major aspect of the query.
           Requires significant revision before use.
Score 3-4:  Response attempts to address the query but contains multiple
           unsupported claims or factual errors. Key information is missing
           or wrong. Not usable without major rewriting.
Score 1-2:  Response is mostly irrelevant or fabricated. Little connection
           between the query and the answer. Would mislead the user.
Score 0:    No response, refusal, or completely nonsensical output.
```

#### Pattern: Decision Tree Rubric

For complex criteria, a decision tree reduces ambiguity better than a scale:

```
Step 1: Does the response attempt to answer the query?
        → No → Score 0
        → Yes → Continue

Step 2: Are the core claims factually correct?
        → All correct → +4 points (base)
        → Mostly correct (1-2 minor errors) → +3 points
        → Mixed (significant errors alongside correct info) → +2 points
        → Mostly wrong → +1 point

Step 3: Are claims grounded in cited sources?
        → All key claims cite sources → +3 points
        → Most claims cite sources → +2 points
        → Few or no citations → +1 point
        → N/A (no sources available) → +2 points (don't penalize)

Step 4: Is the response complete for the query?
        → Covers all aspects → +3 points
        → Covers most aspects → +2 points
        → Major gaps → +1 point

Final score = sum of steps (0-10)
```

This approach decomposes the judgment into independent sub-decisions, reducing cognitive load on the judge and improving consistency.

### 1.4 Score Anchoring Techniques

**Problem:** Score distributions from LLM judges tend to cluster around 7-8/10 (central tendency bias) and avoid extreme scores.

**Technique 1: Provide calibration examples**

Include 2-3 scored examples in the judge prompt to anchor the scale:

```
**Calibration Examples:**

Example A (Score: 9):
Query: "What is our company's PTO policy?"
Response: "According to the Employee Handbook (2024), full-time employees
receive 15 days PTO annually, accruing at 1.25 days/month. PTO requests
require manager approval 2 weeks in advance. Unused PTO carries over up
to 5 days. [Source: Employee Handbook, Section 4.2]"
Why 9: Specific, sourced, complete, directly actionable.

Example B (Score: 4):
Query: "What is our company's PTO policy?"
Response: "Employees get PTO days that they can use for vacation or personal
time. You should check with HR for the specific details about how many days
you get and the request process."
Why 4: Vague, no specifics, no sources, tells user to look elsewhere.
```

**Technique 2: Define the endpoints explicitly**

```
Score 0 means: The response provides zero value. The user is no better off
               than if no response had been generated.
Score 10 means: The response is as good as an expert human would produce
                given the same information and tools. No meaningful improvement
                is possible.
```

**Technique 3: Use wider score ranges to fight central tendency**

Instead of 1-5 (where everything clusters at 3-4), use 0-10 or even 0-100. Wider ranges give the model more room to differentiate.

**Technique 4: Explicitly discourage central clustering**

Add to the prompt:
```
IMPORTANT: Use the full range of scores. A score of 5 is not "average" --
it means the response has significant problems. Most enterprise agent
responses should score between 3-9 depending on quality. Do not default
to 7-8 for acceptable responses.
```

---

## 2. Knowledge Work Evaluation Patterns

Knowledge work agents (enterprise search, RAG, document synthesis) require domain-specific evaluation dimensions that generic LLM evaluation doesn't cover.

### 2.1 Evaluating Factual Groundedness

**What it measures:** Did the agent's claims come from real sources, or were they fabricated?

This is the most critical dimension for enterprise knowledge agents. An agent that confidently states fabricated policies, procedures, or data is worse than one that says "I don't know."

**Two-layer evaluation:**

**Layer 1: Intrinsic groundedness** (does the response stay within what its sources say?)
```
For each factual claim in the response:
1. Is this claim supported by the cited source(s)?
2. Is the claim a reasonable inference from the source, or an extrapolation?
3. Is the claim fabricated (not present or inferable from any source)?

Count:
- Supported claims (directly stated in source)
- Inferred claims (reasonable interpretation of source)
- Unsupported claims (not traceable to any source)
- Contradicted claims (source says the opposite)

Groundedness = (supported + inferred) / total_claims
```

**Layer 2: Factual accuracy** (are the grounded claims actually correct?)

This requires a reference answer or access to ground truth. When available:
```
Compare each factual claim against the reference answer or known facts:
- Correct: Matches reference
- Partially correct: Captures the gist but misses nuance
- Incorrect: Contradicts reference
- Unverifiable: Neither confirmed nor denied by reference
```

**Judge prompt pattern for groundedness:**

```
You are evaluating whether an AI agent's response is grounded in its sources.

For this evaluation, "grounded" means every factual claim in the response
can be traced back to information in the cited sources or the query itself.

TASK: Analyze the response and categorize each factual claim.

A "factual claim" is any statement that asserts something is true about the
world, a process, a policy, a person, a number, a date, or a procedure.
Opinions and hedged statements ("it might be...") are not factual claims.

For each claim, determine:
- SUPPORTED: The source explicitly states this
- INFERRED: A reasonable interpretation of the source
- UNSUPPORTED: Cannot be traced to any source
- CONTRADICTED: The source says the opposite

Then provide your overall score.

REASONING: [List each factual claim and its category]
SCORE: [0-10 based on proportion of supported/inferred vs unsupported/contradicted]
```

### 2.2 Evaluating Completeness for Synthesis Tasks

Synthesis tasks ("summarize this document," "compare these two policies," "give me an overview of X") require evaluating whether the response captured all important aspects.

**The challenge:** Completeness is relative to the query, not absolute. A query asking "what's the main takeaway?" needs less coverage than "give me a comprehensive summary."

**Pattern: Aspect Coverage Matrix**

```
Step 1: Given the query, list the key aspects that a complete response
        should address. Be specific.

Step 2: For each aspect, determine whether the response:
        - COVERED: Addressed with appropriate depth
        - MENTIONED: Touched on but insufficient depth
        - MISSING: Not addressed at all

Step 3: Weight the aspects by importance to the query.

Completeness assessment:
- COMPLETE: All key aspects covered, most at appropriate depth
- PARTIAL: Most key aspects mentioned, but significant gaps in depth
           or 1-2 key aspects missing entirely
- INCOMPLETE: Multiple key aspects missing or only superficially addressed
```

**Example for a synthesis task:**

```
Query: "Compare our Q3 and Q4 sales performance"

Key aspects a complete response should cover:
1. Revenue figures for both quarters (critical)
2. Growth/decline percentage (critical)
3. Top performing segments/products (important)
4. Notable wins or losses (important)
5. Trend context -- is this part of a larger pattern? (nice-to-have)
6. Forward-looking implications (nice-to-have)
```

### 2.3 Evaluating Hallucination

Hallucination in knowledge work agents takes specific forms:

| Type | Description | Example |
|------|-------------|---------|
| **Entity hallucination** | Inventing people, documents, or systems | "According to the Smith Report (2024)..." when no such report exists |
| **Attribute hallucination** | Wrong details about real entities | "The policy was updated in March" when it was updated in June |
| **Relational hallucination** | Wrong relationships between entities | "Team A reports to Director B" when they report to Director C |
| **Numerical hallucination** | Fabricated statistics or numbers | "Revenue grew 23%" when actual growth was 15% |
| **Process hallucination** | Inventing procedures or workflows | "Submit Form X-12 to HR" when no such form exists |

**Judge prompt for hallucination detection:**

```
You are a hallucination detector for an enterprise AI agent.

DEFINITION: A hallucination is any claim that is not supported by the
provided sources AND is stated as fact (not hedged or qualified).

Types to check:
1. ENTITY: Does the response reference any document, person, system,
   or tool that doesn't appear in the sources?
2. ATTRIBUTE: Does the response assign incorrect properties to real
   entities (wrong dates, wrong numbers, wrong descriptions)?
3. PROCESS: Does the response describe procedures or steps that
   aren't documented in the sources?
4. NUMERICAL: Does the response include specific numbers that
   aren't in the sources?

For each potential hallucination found:
- Quote the claim
- Explain why it appears to be hallucinated
- Rate severity: CRITICAL (could cause harm/wrong action),
  MODERATE (misleading but unlikely to cause harm),
  MINOR (irrelevant embellishment)

HALLUCINATIONS_FOUND: [list each with severity]
SCORE: [0-10, where 10 = no hallucinations, 0 = predominantly hallucinated]
```

### 2.4 Evaluating Source Attribution Quality

For RAG systems, attribution quality is distinct from factual accuracy. A response can be accurate but poorly attributed, or well-attributed but citing weak sources.

**Dimensions of attribution quality:**

```
1. COVERAGE: Are the important claims attributed to sources?
   - Every key claim has a citation → High
   - Most claims attributed → Medium
   - Few or no citations → Low

2. PRECISION: Do the citations actually support the claims?
   - All citations accurately support their claims → High
   - Some citations are tangential or don't fully support → Medium
   - Citations are decorative (don't match claims) → Low

3. SPECIFICITY: How specific are the citations?
   - Links to specific sections/pages → High
   - Links to general documents → Medium
   - Vague references ("according to company policy") → Low

4. RECENCY: Are the sources current?
   - Most recent versions cited → High
   - Older versions cited when newer exist → Medium
   - Outdated sources with known updates → Low
```

### 2.5 Relevance Scoring for RAG

RAG relevance operates at two levels: **retrieval relevance** (did the system find the right documents?) and **response relevance** (did the answer address the query?).

**Retrieval relevance** (evaluate retrieved chunks, not the final answer):

```
For each retrieved source/chunk:
- HIGHLY RELEVANT: Directly contains information needed to answer the query
- SOMEWHAT RELEVANT: Contains related information that provides useful context
- IRRELEVANT: Does not contain information useful for answering the query

Retrieval precision = relevant_chunks / total_chunks
```

**Response relevance** (evaluate the final answer):

```
Evaluate how directly the response addresses the user's actual question.

Consider:
1. Does it answer what was asked (not a related but different question)?
2. Does it provide the right level of detail for the query type?
   - Factoid query → concise, specific answer
   - Exploratory query → broader coverage appropriate
   - Procedural query → step-by-step is expected
3. Is there significant off-topic content diluting the answer?

REASONING: [analysis]
SCORE: [0-10]
```

---

## 3. Bias Mitigation

LLM judges exhibit systematic biases. Understanding and mitigating them is essential for reliable evaluation.

### 3.1 Position Bias

**What it is:** When comparing two responses (A vs B), LLM judges tend to prefer whichever is presented first (primacy bias) or last (recency bias), depending on the model. GPT-4 shows primacy bias; Claude tends toward recency.

**Mitigation strategies:**

**Strategy 1: Swap-and-average (mandatory for pairwise comparison)**

Run every comparison twice with positions swapped:
```
Trial 1: "Response A: [model_1_output]  Response B: [model_2_output]"
Trial 2: "Response A: [model_2_output]  Response B: [model_1_output]"
```

If both trials agree, high confidence. If they disagree, mark as a tie or escalate.

**Strategy 2: Use pointwise scoring instead of pairwise comparison**

Instead of "which response is better?", score each response independently against the rubric. This eliminates position bias entirely.

```
# Pairwise (position-biased):
"Compare Response A and Response B. Which is better?"

# Pointwise (no position bias):
"Score this response on a scale of 0-10 against the following rubric..."
# Run separately for each response
```

**Strategy 3: Reference-anchored comparison**

When pairwise comparison is needed, add a reference answer as an anchor:

```
Given the reference answer below, evaluate how well each response
captures the same information.

Reference: [expert answer]
Response A: [...]
Response B: [...]
```

### 3.2 Verbosity Bias

**What it is:** LLM judges systematically prefer longer, more detailed responses even when the additional content doesn't add value. Longer responses feel "more thorough."

**Measured effect:** Studies show a 10-20% scoring advantage for verbose responses across multiple judge models.

**Mitigation strategies:**

**Strategy 1: Explicitly penalize unnecessary verbosity in the rubric**

```
IMPORTANT: Evaluate information density, not length. A concise response
that directly answers the query is BETTER than a longer response that
pads with obvious, redundant, or tangential information.

Deduct points for:
- Repeating the same information in different words
- Including generic caveats that don't add value
- Providing unrequested background that dilutes the answer
- Excessive hedging or qualifications
```

**Strategy 2: Include a brevity-rewarding criterion**

Add a separate "conciseness" criterion scored independently:
```
Conciseness: Does the response communicate its information efficiently?
Score 10: Every sentence adds unique value. No filler.
Score 7-9: Mostly efficient with minor redundancy.
Score 4-6: Noticeable padding or repetition.
Score 1-3: Significantly bloated relative to information content.
```

**Strategy 3: Normalize for length**

In post-processing, flag cases where the winning response is >2x longer than the losing response for human review.

### 3.3 Self-Enhancement Bias

**What it is:** LLM judges tend to prefer outputs generated by the same model family. Claude judges slightly favor Claude outputs; GPT judges slightly favor GPT outputs.

**Measured effect:** 5-15% higher scores for same-family outputs in controlled studies.

**Mitigation strategies:**

**Strategy 1: Cross-model judging**

Use a different model family for judging than what generated the responses:
- Agent uses Claude → Judge with GPT-4
- Agent uses GPT-4 → Judge with Claude

**Strategy 2: Multi-judge ensemble**

Use judges from multiple model families and aggregate:
```
judge_1 = Claude → score_1
judge_2 = GPT-4 → score_2
judge_3 = Gemini → score_3

final_score = median(score_1, score_2, score_3)
confidence = 1 - (std_dev / range)
```

Median is more robust than mean for small ensembles (resistant to one outlier judge).

**Strategy 3: Blind evaluation**

Strip any model-identifying information from responses before judging:
```
# Remove signatures, model names, style markers
response = response.replace(/As an AI assistant.../g, '')
response = response.replace(/I'm Claude.../g, '')
```

### 3.4 Reference-Free vs Reference-Based Evaluation

| Mode | When to Use | Advantages | Disadvantages |
|------|-------------|------------|---------------|
| **Reference-free** | No ground truth available; subjective quality | Scales without human labels; applicable to any task | Less reliable for factual accuracy; judges have no anchor |
| **Reference-based** | Known correct answer exists; factual tasks | More reliable for correctness; better calibrated | Requires expensive reference answers; brittle to paraphrasing |
| **Hybrid** | Reference available but response doesn't need to match exactly | Best of both; reference grounds judgment without requiring exact match | Reference can bias toward its specific framing |

**Hybrid implementation (recommended for knowledge work):**

```
You are evaluating an AI agent's response to a user query.

An expert-written reference answer is provided for context. The reference
represents one acceptable answer, not the only acceptable answer. The agent's
response may use different wording, structure, or emphasis and still be correct.

Use the reference to:
- Verify factual accuracy of specific claims
- Check for missing key information
- Identify hallucinated content not in the reference

Do NOT penalize the agent for:
- Different phrasing or structure than the reference
- Including additional correct information not in the reference
- A different but equally valid interpretation of the query
```

---

## 4. Multi-Criteria Scoring

### 4.1 Decomposing Quality into Independent Dimensions

**Principle:** A single "quality" score is unreliable and unactionable. Decompose into dimensions that can be independently assessed and independently improved.

**Recommended dimensions for knowledge work agents:**

| Dimension | What It Measures | Score Type | Independence Check |
|-----------|-----------------|------------|-------------------|
| **Task Success** | Did it do what was asked? | Continuous (0-10) | Can succeed at wrong task → independent of relevance |
| **Factual Groundedness** | Are claims from real sources? | Continuous (0-10) | Can be grounded but irrelevant → independent of relevance |
| **Relevance** | Does it address the actual query? | Continuous (0-10) | Can be relevant but wrong → independent of factuality |
| **Completeness** | Did it cover all key aspects? | Categorical (3-tier) | Can be complete but wrong → independent of factuality |
| **Attribution Quality** | Are sources properly cited? | Continuous (0-10) | Can cite well but cite wrong sources → independent of factuality |
| **Conciseness** | Is it information-dense? | Continuous (0-10) | Can be concise but wrong → independent of factuality |
| **Safety** | Is the output appropriate? | Binary | Orthogonal to all quality dimensions |
| **Tool Usage** | Did it use the right tools? | Binary | Process measure, not output measure |

**Independence test:** Two dimensions are independent if you can construct a response that scores high on one and low on the other. If you can't, they're likely measuring the same thing and should be merged.

### 4.2 Weighted vs Unweighted Scoring

**When to weight:**
- When some dimensions matter more for the specific use case
- When you want a single aggregate score for comparison
- When different agent types have different priority hierarchies

**When NOT to weight:**
- During development (you need to see each dimension separately)
- When dimensions are not on the same scale
- When you don't have empirical data on relative importance

**Weight assignment approaches:**

**Approach 1: Use-case driven weights**

```typescript
const WEIGHTS = {
  // For a compliance/policy agent:
  compliance: {
    factuality: 1.0,    // Getting it wrong has real consequences
    completeness: 0.9,   // Missing a clause could be costly
    attribution: 0.8,    // Users need to verify
    relevance: 0.7,      // Important but secondary to accuracy
    conciseness: 0.3,    // Thoroughness > brevity here
    safety: 1.0,         // Non-negotiable
  },
  // For a quick-answer agent:
  quickAnswer: {
    relevance: 1.0,      // Must answer the right question
    factuality: 0.9,     // Accuracy matters
    conciseness: 0.8,    // Users want fast answers
    completeness: 0.5,   // Good enough > comprehensive
    attribution: 0.4,    // Nice to have
    safety: 1.0,         // Non-negotiable
  }
}
```

**Approach 2: Empirical weight learning**

If you have human preference data, learn weights that maximize correlation:
```
human_preference ~ w1*factuality + w2*relevance + w3*completeness + ...
```

### 4.3 Binary vs Continuous Scales

| Scale | When to Use | Example Criteria |
|-------|-------------|-----------------|
| **Binary (yes/no)** | Clear threshold; no meaningful gradation | Safety, tool usage correctness, contains PII |
| **Categorical (3-5 tiers)** | Qualitative assessment; meaningful tiers | Completeness (complete/partial/incomplete) |
| **Continuous (0-10)** | Nuanced quality; need to track improvement | Factuality, relevance, task success |
| **Continuous (0-100)** | Need fine granularity; statistical analysis | Only if analyzing large samples |

**Decision rule:** Use the simplest scale that captures the distinction you care about. If you can't articulate what differentiates a 6 from a 7 on a criterion, use a categorical or binary scale instead.

**Combining scales for aggregate scoring:**

When you need to aggregate scores across different scale types, normalize:

```typescript
function normalizeScore(criterion: CriterionDefinition, rawScore: number | string): number {
  switch (criterion.scoreType) {
    case 'binary':
      return rawScore === 1 || rawScore === 'yes' ? 1.0 : 0.0
    case 'categorical':
      // Map categories to 0-1 range
      const categories = criterion.scaleConfig?.categories || []
      const index = categories.indexOf(rawScore as string)
      return index / (categories.length - 1) // 'complete'=1.0, 'partial'=0.5, 'incomplete'=0.0
    case 'continuous':
      return (rawScore as number) / 10 // Normalize 0-10 to 0-1
    default:
      return rawScore as number
  }
}
```

---

## 5. Notable Frameworks and Papers

### 5.1 G-Eval (Liu et al., 2023)

**Paper:** "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment"

**Key contribution:** Framework for using LLMs as NLG evaluators with chain-of-thought and form-filling.

**How it works:**
1. Define the evaluation task and criteria
2. Ask the LLM to generate detailed evaluation steps (CoT)
3. Use those steps to evaluate the response
4. Use token probabilities to compute a weighted score (rather than taking the single output number)

**What Seer can adopt:**
- CoT-first evaluation (already implemented in `judge.ts`)
- Probability-weighted scoring: Instead of taking the single score the model outputs, average over the probability distribution of score tokens. This reduces variance significantly. Practical approximation when you lack token probabilities: run the same eval 3-5 times and take the mean.
- Separate evaluation steps per criterion dimension

**Limitations:** Token probability access isn't available through all APIs. The practical alternative (multiple runs + mean) is more expensive.

### 5.2 MT-Bench and Chatbot Arena (Zheng et al., 2023)

**Paper:** "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"

**Key contributions:**
- Demonstrated that strong LLM judges (GPT-4) achieve >80% agreement with human preferences
- Identified and quantified position bias, verbosity bias, and self-enhancement bias
- Proposed swap-and-average for pairwise comparisons
- Showed that single-answer grading (pointwise) has different bias profiles than pairwise comparison

**What Seer can adopt:**
- Pointwise scoring over pairwise (already the approach in Seer -- good)
- Position swap for any future A/B comparison features
- Agreement rate as a meta-metric for judge quality
- Multi-turn evaluation (MT-Bench evaluates follow-up turns separately)

**Key finding for knowledge work:** Agreement between LLM judge and human expert was highest for factual/knowledge tasks (~85%) and lowest for creative/open-ended tasks (~65%). This is good news for enterprise knowledge agent evaluation.

### 5.3 RAGAS (Retrieval Augmented Generation Assessment)

**Framework:** Open-source RAG evaluation framework with component-level metrics.

**Core metrics:**

| Metric | What It Measures | Type |
|--------|-----------------|------|
| **Faithfulness** | Are answer claims supported by the context? | Reference-free (uses retrieved context) |
| **Answer Relevancy** | Does the answer address the question? | Reference-free |
| **Context Precision** | Are the retrieved contexts relevant? | Needs ground truth |
| **Context Recall** | Did retrieval find all needed information? | Needs ground truth |
| **Answer Correctness** | Is the answer factually correct? | Reference-based |
| **Answer Similarity** | Semantic similarity to reference answer | Reference-based |

**RAGAS Faithfulness algorithm:**
1. Extract all claims/statements from the answer
2. For each claim, check if it can be inferred from the retrieved context
3. Faithfulness = (supported claims) / (total claims)

**What Seer can adopt:**
- Decomposed RAG evaluation (separate retrieval quality from generation quality)
- Faithfulness as a first-class metric (maps to Seer's `factuality` criterion)
- Context precision/recall when ground truth retrieval sets are available
- Claim-level analysis rather than holistic assessment

**Practical adaptation for Seer:**

RAGAS uses LLM calls for claim extraction and verification. This can be expensive. A practical middle ground:

```
Instead of extracting every claim individually (costly):

1. Ask the judge to identify the 3-5 most important factual claims
2. Verify each against the context
3. Score based on verification results

This captures ~80% of the signal at ~20% of the cost.
```

### 5.4 Prometheus (Kim et al., 2024)

**Paper:** "Prometheus: Inducing Fine-Grained Evaluation Capability in Language Models"

**Key contribution:** Showed that you can fine-tune smaller models to be effective judges using rubric-based evaluation data. The key insight: the rubric in the prompt is the primary driver of judge quality, more so than the model's raw capability.

**What Seer can adopt:**
- Rubric specificity matters more than model size
- Fine-grained, criterion-specific rubrics outperform generic "evaluate quality" prompts
- Reference answers improve judge reliability even when they're imperfect

### 5.5 JudgeBench and Meta-Evaluation

**Problem:** How do you know your judge is any good?

**Meta-evaluation approaches:**

1. **Human agreement rate:** Have humans score a subset; compute correlation (Spearman/Kendall) with judge scores. Target: >0.7 Spearman correlation.

2. **Judge consistency:** Run the same evaluation multiple times. Compute intra-judge agreement (Cohen's kappa for categorical, ICC for continuous). Target: >0.8.

3. **Known-answer tests:** Include test cases with known scores (a clearly terrible response that should score 0-2, a clearly excellent one that should score 9-10). If the judge fails these, the rubric or prompt needs work.

4. **Adversarial tests:** Construct responses designed to exploit known biases (a verbose but wrong answer, a concise but correct one). Check if the judge handles them correctly.

### 5.6 Enterprise-Specific Patterns

Enterprise knowledge agent evaluation has unique requirements not covered by academic benchmarks:

**1. Domain-specific correctness**

Generic LLM judges lack domain knowledge. For enterprise evals, provide domain context:

```
DOMAIN CONTEXT: You are evaluating an agent that answers questions about
[Company X]'s internal policies. The agent has access to the company's
knowledge base including HR policies, engineering documentation, and
financial reports. Claims should be grounded in these sources.

Things the agent SHOULD know (from its knowledge base):
- Internal processes and policies
- Employee-facing information
- Product documentation

Things the agent SHOULD NOT claim to know:
- Confidential financial details not in its sources
- Individual employee information
- Future plans not publicly documented
```

**2. Actionability evaluation**

Enterprise users need answers they can act on. Generic quality doesn't capture this:

```
Actionability: Could the user take the correct next step based solely
on this response?
- YES: Response includes specific, correct action steps
- PARTIALLY: Response points in the right direction but user needs
  more information
- NO: Response doesn't help the user know what to do next
```

**3. Confidence calibration**

Enterprise agents should express appropriate uncertainty:

```
Confidence Calibration:
- WELL CALIBRATED: Agent is confident when correct, hedges when uncertain
- OVERCONFIDENT: Agent states uncertain information as fact
- UNDERCONFIDENT: Agent hedges on information it should be confident about
- N/A: Response doesn't involve uncertainty
```

---

## 6. Prompt Templates

### 6.1 General-Purpose Knowledge Work Judge

```
You are an expert evaluator assessing an AI agent's response to a
knowledge work query. Your evaluation must be rigorous, specific,
and grounded in observable features of the response.

=== EVALUATION CRITERION ===
Name: {criterion_name}
Description: {criterion_description}

=== SCORING RUBRIC ===
{rubric_with_anchored_score_levels}

=== MATERIAL TO EVALUATE ===

Original Query:
{query}

{if reference_answer}
Expert Reference Answer (for calibration -- the agent's response does
not need to match this exactly, but should cover the same key facts):
{reference_answer}
{/if}

Agent Response:
{response}

=== INSTRUCTIONS ===
1. Analyze the response against each element of the rubric
2. Note specific strengths and weaknesses with quotes from the response
3. Determine your score
4. Use the full scoring range. A middling score (5/10) means significant
   problems exist, not "average quality."

Respond in exactly this format:

REASONING: [2-4 sentences analyzing the response against the rubric.
Cite specific parts of the response.]
SCORE: [number 0-10]
```

### 6.2 Faithfulness / Groundedness Judge

```
You are evaluating whether an AI agent's response is grounded in
its retrieved sources. This is an enterprise knowledge system where
accuracy is critical -- users will make decisions based on this output.

=== TASK ===
Identify factual claims in the response and verify each against the
available sources.

=== DEFINITIONS ===
- Factual claim: A statement asserting something specific is true
  (a fact, number, date, name, process, policy, etc.)
- NOT claims: Opinions, hedged statements ("it might be"),
  meta-commentary ("I found several sources")

=== MATERIAL ===

Query: {query}

Retrieved Sources:
{sources_text}

Agent Response:
{response}

=== INSTRUCTIONS ===
1. List every factual claim in the response (aim to be exhaustive)
2. For each claim, classify:
   - SUPPORTED: Source explicitly states this
   - INFERRED: Reasonable interpretation of source content
   - UNSUPPORTED: Not found in any source, stated as fact
   - CONTRADICTED: Source says the opposite
3. Count claims in each category
4. Score based on the ratio of (SUPPORTED + INFERRED) to total claims

CLAIMS:
1. "[claim text]" → [SUPPORTED/INFERRED/UNSUPPORTED/CONTRADICTED]
   (source: [which source or "none"])
2. ...

SUMMARY: [X] supported, [Y] inferred, [Z] unsupported, [W] contradicted
out of [total] claims

SCORE: [0-10 where 10 = all claims supported/inferred,
0 = all claims unsupported/contradicted]
```

### 6.3 Completeness Judge (Categorical)

```
You are evaluating the completeness of an AI agent's response to a
knowledge work query.

=== TASK ===
Determine whether the response covers all aspects that a thorough
answer to this query should include.

=== MATERIAL ===

Query: {query}

{if reference_answer}
Reference Answer (defines expected scope):
{reference_answer}
{/if}

Agent Response:
{response}

=== INSTRUCTIONS ===
1. List the key aspects that a complete answer to this query should cover
2. For each aspect, check if the response addresses it adequately
3. Classify the response into one of three categories

=== CATEGORIES ===
- COMPLETE: All key aspects addressed with appropriate depth. A user
  reading this response would have a full understanding of the answer.
- PARTIAL: Most key aspects addressed, but either 1-2 important aspects
  are missing or covered too superficially to be useful.
- INCOMPLETE: Multiple key aspects missing. A user reading this would
  have significant gaps in their understanding.

ASPECTS:
1. [aspect] → [COVERED / MENTIONED / MISSING]
2. ...

REASONING: [1-2 sentences explaining classification]
CATEGORY: [COMPLETE / PARTIAL / INCOMPLETE]
```

### 6.4 Hallucination Detection Judge (Binary)

```
You are a hallucination detector for an enterprise AI agent. Your job
is to determine if the response contains any fabricated information
presented as fact.

=== CRITICAL CONTEXT ===
In enterprise settings, hallucinations can cause users to take wrong
actions based on false information. Even one significant hallucination
in an otherwise good response is a failure.

=== DEFINITIONS ===
Hallucination: A specific factual claim that is:
- NOT present in the retrieved sources
- NOT common knowledge (e.g., "the sky is blue" is fine)
- Stated as fact (not hedged with "I think" or "it's possible")

NOT hallucination:
- Correct inferences from source material
- Common knowledge not requiring a source
- Appropriately hedged uncertain claims
- Paraphrasing that preserves meaning

=== MATERIAL ===

Query: {query}
Retrieved Sources: {sources_text}
Agent Response: {response}

=== INSTRUCTIONS ===
1. Read the response carefully
2. Identify any claims that cannot be traced to the sources or
   common knowledge
3. For each potential hallucination, assess severity:
   - CRITICAL: Could cause wrong action or decision
   - MINOR: Embellishment that doesn't affect core answer

POTENTIAL_HALLUCINATIONS:
1. "[quote]" - [CRITICAL/MINOR] - [why it appears fabricated]
2. ...
(or "None detected")

REASONING: [1-2 sentences on overall assessment]
ANSWER: [yes = no hallucinations found / no = hallucinations detected]
```

### 6.5 Multi-Criterion Batch Judge (Efficiency Pattern)

When running multiple criteria, you can batch them into a single call to reduce latency and cost. This trades some independence for efficiency:

```
You are evaluating an AI agent's response across multiple quality
dimensions. Evaluate each dimension independently -- a high score
on one dimension should not influence your score on another.

=== MATERIAL ===
Query: {query}
Agent Response: {response}
{if reference_answer}Reference: {reference_answer}{/if}

=== EVALUATE EACH DIMENSION ===

**1. Task Success (0-10)**
Did the agent accomplish what was asked?
10: Fully accomplished | 5: Partially | 0: Complete failure

**2. Factual Groundedness (0-10)**
Are claims supported by sources?
10: All claims verified | 5: Mix of verified and unverified | 0: Fabricated

**3. Relevance (0-10)**
Does the response address the actual query?
10: Perfectly on-topic | 5: Partially relevant | 0: Wrong question answered

**4. Conciseness (0-10)**
Is the response appropriately sized?
10: Every sentence adds value | 5: Some padding | 0: Mostly filler

=== FORMAT ===
TASK_SUCCESS_REASONING: [1-2 sentences]
TASK_SUCCESS_SCORE: [0-10]

GROUNDEDNESS_REASONING: [1-2 sentences]
GROUNDEDNESS_SCORE: [0-10]

RELEVANCE_REASONING: [1-2 sentences]
RELEVANCE_SCORE: [0-10]

CONCISENESS_REASONING: [1-2 sentences]
CONCISENESS_SCORE: [0-10]
```

**Tradeoff:** Batch evaluation is 2-4x cheaper but shows ~5% lower inter-criterion independence compared to separate calls. Use separate calls when you need maximum reliability; use batch when running at scale.

---

## Appendix A: Implementation Checklist

When building or improving an LLM-as-judge system:

- [ ] **Rubric specificity:** Can you distinguish adjacent score levels with concrete examples?
- [ ] **CoT ordering:** Does reasoning come before the score in the output format?
- [ ] **Score anchoring:** Are the endpoints of the scale explicitly defined?
- [ ] **Calibration examples:** Are 2-3 pre-scored examples included for continuous scales?
- [ ] **Anti-verbosity:** Does the rubric explicitly address length vs. quality?
- [ ] **Bias controls:** Is position swapping implemented for any pairwise comparisons?
- [ ] **Parse reliability:** Does the output format have clear delimiters for reliable parsing?
- [ ] **Meta-evaluation:** Have you tested the judge on known-good and known-bad responses?
- [ ] **Consistency check:** Run the same eval 3+ times -- are scores within 1 point?
- [ ] **Independence:** Are your criteria actually measuring different things?

## Appendix B: Key References

| Reference | Year | Key Contribution |
|-----------|------|------------------|
| G-Eval (Liu et al.) | 2023 | CoT + probability-weighted NLG evaluation |
| MT-Bench / Chatbot Arena (Zheng et al.) | 2023 | Position/verbosity/self-enhancement bias analysis |
| RAGAS (Es et al.) | 2023 | Component-level RAG metrics (faithfulness, relevance, precision, recall) |
| Prometheus (Kim et al.) | 2024 | Rubric-driven fine-grained evaluation; rubric > model size |
| JudgeLM (Zhu et al.) | 2023 | Training judge models with human preference data |
| FActScore (Min et al.) | 2023 | Fine-grained claim-level factuality evaluation |
| ARES (Saad-Falcon et al.) | 2024 | Automated RAG evaluation with synthetic preference data |
| Self-Taught Evaluators (Wang et al.) | 2024 | Training evaluators without human labels |
| Judging the Judges (Bavaresco et al.) | 2024 | Comprehensive meta-evaluation of LLM judge reliability |

## Appendix C: Seer-Specific Recommendations

Based on Seer's current implementation (`judge.ts`, `defaults.ts`):

1. **Current state is solid.** CoT-then-score ordering, structured parsing, typed criteria -- the foundation is right.

2. **Improve rubric anchoring.** The current rubrics use range descriptions ("Score 7-9: Mostly complete"). Add concrete behavioral examples at each level, especially for `task_success` and `factuality`.

3. **Add calibration examples.** For continuous criteria, include 2-3 pre-scored examples in the judge prompt to anchor the scale. This is the single highest-impact improvement available.

4. **Add anti-verbosity language.** The current rubrics don't address length bias. Add explicit language about information density vs. length to `relevance` and `task_success` rubrics.

5. **Consider batch evaluation.** For cost efficiency, the multi-criterion batch pattern (Section 6.5) could reduce API calls by 4-5x for standard evals while maintaining acceptable accuracy.

6. **Meta-evaluation baseline.** Before trusting judge scores, run 10-20 cases with known quality levels (manually scored). Compute agreement. If agreement < 0.7, iterate on rubrics before scaling.

7. **Faithfulness criterion.** Add a dedicated faithfulness/groundedness criterion (Section 6.2) that operates at the claim level. This is the most important dimension for enterprise knowledge agents and is distinct from the current `factuality` criterion, which blends groundedness with accuracy.

---

*This guide synthesizes research from G-Eval, MT-Bench, RAGAS, Prometheus, FActScore, and applied LLM evaluation practice through early 2025.*

-- Axon | 2026-02-13
