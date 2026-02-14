# QA Pair Grading with LLM Judges

**Prompt templates, score calibration, and implementation patterns for evaluating agent responses against expected answers.**

This guide covers the specific case where you have a known-good (or known-approximate) expected answer and need to score an agent's actual response against it. Not behavioral evals, not safety evals -- QA grading for knowledge synthesis agents.

---

## Table of Contents

1. [The QA Grading Setup](#1-the-qa-grading-setup)
2. [Prompt Architecture for QA Pairs](#2-prompt-architecture-for-qa-pairs)
3. [Score Calibration for Knowledge Synthesis](#3-score-calibration-for-knowledge-synthesis)
4. [Handling Partial Matches and Theme Coverage](#4-handling-partial-matches-and-theme-coverage)
5. [Ready-to-Use Prompt Templates](#5-ready-to-use-prompt-templates)
6. [Framework Patterns Worth Stealing](#6-framework-patterns-worth-stealing)
7. [Anti-Patterns](#7-anti-patterns)
8. [Implementation Notes for Seer](#8-implementation-notes-for-seer)

---

## 1. The QA Grading Setup

### The Data Shape

Every QA eval case has three components:

```
input:           The query sent to the agent
expected_output: A description of what a good response looks like
actual_output:   What the agent actually returned
```

The judge sees all three and produces scores on multiple dimensions.

### Why This Is Harder Than It Sounds

The expected output in knowledge synthesis tasks is NOT an exact string match target. It is a description of themes, topics, and facts that should appear. The agent might use different words, different structure, include additional valid information, or cover the same ground from a different angle.

This means the judge must:
- Understand semantic equivalence (not string matching)
- Distinguish between "different wording, same content" and "actually wrong"
- Handle the case where the agent found information the expected answer didn't cover
- Handle partial coverage without collapsing to binary pass/fail

### The Three Scoring Dimensions

For enterprise search + synthesis agents, three dimensions capture the signal:

| Dimension | Question It Answers | Why It Matters Independently |
|-----------|--------------------|-----------------------------|
| **Task Success** | Did it do what was asked? | Can succeed at the wrong task (high task success, low relevance) |
| **Factuality** | Is it grounded in real data? | Can be grounded but irrelevant (high factuality, low relevance) |
| **Relevance** | Does it answer the right question? | Can be relevant but wrong (high relevance, low factuality) |

---

## 2. Prompt Architecture for QA Pairs

### 2.1 Information Ordering: Expected Before Actual

**Show the expected answer before the actual response.** This is critical.

The judge needs the expected answer as a reference frame before encountering the actual output. If you show actual first, the judge forms an impression of the response before knowing what "good" looks like. This leads to:
- Higher variance in scores (judge's internal standard shifts per-case)
- Anchoring to the actual response's quality level rather than the expected standard
- The expected answer becoming a post-hoc comparison rather than a rubric

The correct ordering:

```
1. Role and task definition
2. Scoring rubric with anchored scale points
3. The query (input)
4. The expected answer (reference frame)
5. The actual response (what we're grading)
6. Instructions for comparison
7. Output format
```

This mirrors how a human grader works: read the rubric, read the answer key, then grade the submission.

### 2.2 XML Tag Structure

Use XML tags to delimit each section. This prevents the judge from confusing content boundaries (e.g., treating part of the expected answer as instructions).

```xml
<query>{the user's original question}</query>

<expected_answer>{description of what a good response should contain}</expected_answer>

<actual_response>{what the agent returned}</actual_response>
```

Why XML tags specifically:
- Claude and GPT models are trained on XML-heavy data; they respect tag boundaries
- Makes parsing the judge's output reliable
- Prevents prompt injection from the content being evaluated (an actual response containing "Score: 10" won't confuse the parser if the real score lives in `<score>` tags)

### 2.3 Framing the Expected Answer

The expected answer is a **reference**, not the **only correct answer**. The judge prompt must make this explicit, or it will penalize valid responses that diverge from the reference's specific wording.

**Good framing:**

```
The expected answer below describes the key themes, facts, and topics that
a high-quality response should cover. It represents one valid way to answer
the query, not the only valid way.

Use the expected answer to:
- Identify the key information the response should contain
- Verify factual claims against known-good data
- Check for missing critical information
- Detect hallucinated content not present in the expected answer

Do NOT penalize the response for:
- Using different words or structure than the expected answer
- Including additional correct information beyond the expected answer
- Organizing the same information differently
- A different but equally valid interpretation of the query
```

**Bad framing:**

```
Compare the response to the expected answer and score how closely it matches.
```

The "closely matches" framing turns the judge into a string similarity engine. You want semantic grading, not diff output.

### 2.4 Comparison Instructions

After presenting both answers, tell the judge exactly HOW to compare them:

```
=== HOW TO COMPARE ===

Step 1: Extract the key claims from the expected answer. List them.
Step 2: For each key claim, check if the actual response covers it
        (same information, possibly different wording).
Step 3: Check if the actual response contains claims NOT in the
        expected answer. For each, determine if they are:
        - Additional correct information (neutral or positive)
        - Hallucinated/fabricated information (negative)
Step 4: Assess overall quality using the rubric below.
```

This decomposition forces the judge to work claim-by-claim rather than forming a holistic impression. Holistic impressions are where verbosity bias and position bias creep in.

---

## 3. Score Calibration for Knowledge Synthesis

### 3.1 Task Success (0-10): "Did it find the right info?"

Task success for a synthesis agent means: given a query like "What are the main themes from customer feedback about Feature X?", did the agent actually search for and synthesize information about Feature X?

**Calibrated scale:**

```
Score 9-10: FULL SUCCESS
  The response directly answers the query. All major themes/facts from
  the expected answer are present. The response could be used as-is
  by the person who asked the question. No follow-up needed.

  Example: Query asks for top customer complaints. Response lists all
  major complaint categories with specific examples and frequency data.

Score 7-8: SUBSTANTIAL SUCCESS
  The response answers the query correctly but has minor gaps. Covers
  most (75%+) of the expected themes/facts. A user would get value but
  might need to ask one follow-up question.

  Example: Query asks for top customer complaints. Response covers 4 of
  5 major categories and provides good detail, but misses one category
  that represents 10% of complaints.

Score 5-6: PARTIAL SUCCESS
  The response addresses the right topic but has significant gaps.
  Covers roughly half the expected themes/facts. Useful as a starting
  point but requires significant supplementation.

  Example: Query asks for top customer complaints. Response identifies
  3 of 5 categories but provides thin detail and misses the two most
  recent complaint trends.

Score 3-4: MINIMAL SUCCESS
  The response touches on the right area but misses the mark. Covers
  only 1-2 expected themes or covers them so superficially they aren't
  actionable. The user would need to start over.

  Example: Query asks for top customer complaints. Response gives a
  generic statement like "customers have expressed some concerns about
  the product" without specifics.

Score 1-2: NEAR FAILURE
  The response exists and is related to the general domain but does not
  meaningfully address the query. Answers a different question, or provides
  information from the wrong time period / wrong product / wrong context.

Score 0: COMPLETE FAILURE
  No response, a refusal, completely nonsensical output, or an answer
  about an entirely unrelated topic.
```

### 3.2 Factuality (0-10): "Is it grounded in real sources?"

Factuality for synthesis agents means: are the claims in the response traceable to real documents, data, or sources? This is about groundedness, not opinion quality.

**Calibrated scale:**

```
Score 9-10: FULLY GROUNDED
  Every factual claim in the response is either: (a) directly supported
  by cited sources, (b) a reasonable inference from source material, or
  (c) common knowledge that doesn't require citation.
  No fabricated details. Numbers, dates, names, and processes are all
  accurate per the expected answer.

  Example: Response states "Q3 revenue was $12.4M, up 15% from Q2"
  and this matches the source data exactly.

Score 7-8: MOSTLY GROUNDED
  The core claims are accurate and grounded. 1-2 minor details may be
  unsupported but plausible (e.g., a rough percentage where the exact
  number was available). No critical errors.

  Example: Response correctly identifies key themes but rounds "23.7%
  growth" to "about 25% growth" -- imprecise but not misleading.

Score 5-6: MIXED GROUNDEDNESS
  Some claims are grounded, others are not. The response contains at
  least one significant unsupported claim that could mislead the reader.
  The core direction may be right, but specific details are unreliable.

  Example: Response correctly identifies that customer churn increased
  but attributes it to "pricing changes" when the source data points
  to "product quality issues."

Score 3-4: POORLY GROUNDED
  Multiple factual errors or fabricated details. Key claims cannot be
  traced to sources. The response presents unverified information as
  established fact. Reading this would give the user a wrong picture.

  Example: Response invents specific metrics ("NPS dropped from 72 to
  45") that don't appear in any source material.

Score 1-2: LARGELY FABRICATED
  Most claims appear fabricated. The response reads like it was generated
  without access to real data. Confident tone about wrong information.

Score 0: ENTIRELY FABRICATED
  Nothing in the response connects to real source data. Pure
  hallucination or a confident response about the wrong entity/topic.
```

### 3.3 Relevance (0-10): "Does it answer what was asked?"

Relevance is about query-response alignment. A response can be factually accurate and well-grounded but answer the wrong question.

**Calibrated scale:**

```
Score 9-10: PERFECTLY RELEVANT
  Every part of the response directly serves the query. No tangential
  content. The response matches the query's intent (not just its
  keywords) and provides the right type of answer (e.g., a comparison
  when asked to compare, a summary when asked to summarize).

  Example: Query: "Compare Q3 and Q4 pipeline." Response: structured
  comparison of both quarters with clear differentiators.

Score 7-8: MOSTLY RELEVANT
  The response addresses the query's core intent. May include minor
  tangential information that doesn't detract significantly. Correct
  answer type for the question asked.

  Example: Query: "Compare Q3 and Q4 pipeline." Response provides good
  comparison but includes a paragraph about general market conditions
  that wasn't asked for.

Score 5-6: PARTIALLY RELEVANT
  The response touches on the right topic but either: (a) answers a
  related but different question, (b) provides the wrong type of
  answer (e.g., a list when comparison was needed), or (c) mixes
  relevant and irrelevant content roughly equally.

  Example: Query: "Compare Q3 and Q4 pipeline." Response describes
  Q4 pipeline in detail but barely mentions Q3 -- provides a report
  rather than a comparison.

Score 3-4: MARGINALLY RELEVANT
  The response is in the right general domain but does not address the
  specific query. Would require significant reframing to be useful.

  Example: Query: "Compare Q3 and Q4 pipeline." Response discusses
  company revenue trends generally, mentions pipeline briefly.

Score 1-2: BARELY RELEVANT
  The response shares a keyword or two with the query but addresses
  an entirely different topic or need.

Score 0: COMPLETELY IRRELEVANT
  No connection between the query and the response. Wrong topic,
  wrong entity, or a refusal/error message.
```

---

## 4. Handling Partial Matches and Theme Coverage

### 4.1 The Problem

The expected answer says: "The response should cover themes A, B, C, D, E, and F."

The actual response covers A, B, C, D (well), mentions E (briefly), and misses F entirely. But it also includes theme G, which is correct and relevant but wasn't in the expected answer.

How do you score this?

### 4.2 The Theme Decomposition Pattern

Break the expected answer into discrete, scoreable claims or themes. Then evaluate coverage systematically.

```
=== THEME COVERAGE ANALYSIS ===

Step 1: Extract key themes from the expected answer. Number them.
Step 2: For each expected theme, classify the actual response's coverage:
  - COVERED:   Theme is present with sufficient detail to be useful
  - TOUCHED:   Theme is mentioned but lacks the depth or specifics needed
  - MISSING:   Theme is absent from the response entirely

Step 3: Check for additional themes in the actual response:
  - BONUS:     Correct, relevant information beyond the expected answer
  - HALLUCINATED: Information not grounded in sources, presented as fact

Step 4: Calculate coverage metrics:
  - Coverage ratio = (COVERED + 0.5 * TOUCHED) / total_expected_themes
  - Bonus ratio = BONUS / (total_expected_themes + BONUS)
  - Hallucination count = number of HALLUCINATED items

Step 5: Map to score using the rubric.
```

### 4.3 Weighted Theme Coverage

Not all themes matter equally. In practice, the expected answer often has 2-3 critical themes and several supporting ones. Weight accordingly.

```
=== WEIGHTED THEME COVERAGE ===

For each theme in the expected answer, assign importance:
  - CRITICAL: Must be present for the response to be useful
  - IMPORTANT: Should be present in a thorough response
  - SUPPLEMENTARY: Nice to have, adds depth

Scoring impact:
  - Missing a CRITICAL theme: cap task_success at 5/10 maximum
  - Missing an IMPORTANT theme: -1 to -2 points
  - Missing a SUPPLEMENTARY theme: -0.5 points
  - Adding BONUS relevant content: no penalty (and optionally +0.5)
```

### 4.4 The "4 of 6 Themes" Scoring Example

Concrete example of how the judge should handle partial coverage:

**Expected answer themes:**
1. [CRITICAL] Customer churn increased 12% in Q3
2. [CRITICAL] Primary driver was product reliability issues
3. [IMPORTANT] Enterprise segment most affected
4. [IMPORTANT] SMB segment showed improvement
5. [SUPPLEMENTARY] Competitor pricing played a minor role
6. [SUPPLEMENTARY] New onboarding flow reduced time-to-value

**Actual response covers:**
- Theme 1: COVERED (mentions 12% increase)
- Theme 2: COVERED (identifies reliability as root cause)
- Theme 3: COVERED (discusses enterprise impact)
- Theme 4: TOUCHED (mentions SMB briefly without data)
- Theme 5: MISSING
- Theme 6: MISSING
- BONUS: Correctly notes that support ticket volume correlates with churn

**Score mapping:**
- Both CRITICAL themes covered -> no cap
- 3 of 4 IMPORTANT/SUPPLEMENTARY covered or touched
- Weighted coverage: (2 * 1.0 + 1 * 1.0 + 1 * 0.5) / (2 + 2 + 2) = 3.5 / 6 = ~58%
- Plus bonus content (correct, relevant)
- Task success: **7/10** -- substantial success, minor gaps
- Factuality: Score separately based on claim verification
- Relevance: Score separately based on query alignment

### 4.5 When the Expected Answer Is a Description, Not a List

Sometimes the expected answer reads like: "The response should synthesize customer feedback about the new dashboard, highlighting both positive reception of the visualization features and concerns about load times and mobile responsiveness."

The judge needs to decompose this narrative into checkable claims:

```
=== DECOMPOSITION INSTRUCTIONS ===

The expected answer is a narrative description of what good looks like.
Before scoring, decompose it into discrete, checkable elements:

1. Read the expected answer carefully
2. Extract each distinct factual claim, topic, or theme as a
   numbered item
3. Distinguish between:
   - FACTUAL CLAIMS: Specific assertions that can be verified
     (e.g., "load times increased by 2x")
   - THEMATIC REQUIREMENTS: Topics that should be covered
     (e.g., "should discuss mobile responsiveness")
   - STRUCTURAL REQUIREMENTS: How the answer should be organized
     (e.g., "should highlight both positive and negative feedback")
4. Evaluate the actual response against each extracted element
```

---

## 5. Ready-to-Use Prompt Templates

### 5.1 Multi-Dimension QA Judge (Primary Template)

This is the main template for Seer's QA grading. Scores task_success, factuality, and relevance in a single call.

```xml
You are an expert evaluator for an enterprise AI agent that searches company
knowledge and synthesizes answers. You will grade the agent's response against
a reference answer on three independent dimensions.

=== SCORING RUBRIC ===

**Task Success (0-10):** Did the agent accomplish what was asked?
  9-10: All key themes/facts from the reference are present. Usable as-is.
  7-8:  Most themes covered (75%+). Minor gaps only.
  5-6:  About half the expected content present. Useful starting point.
  3-4:  Touches on the topic but misses most expected content.
  1-2:  Related domain but wrong question answered.
  0:    Complete failure, refusal, or nonsense.

**Factuality (0-10):** Are the claims grounded in real data?
  9-10: Every claim verifiable. No fabricated details.
  7-8:  Core claims accurate. 1-2 minor imprecisions.
  5-6:  Mix of grounded and unverified claims.
  3-4:  Multiple unsupported claims stated as fact.
  1-2:  Most content appears fabricated.
  0:    Entirely fabricated or about the wrong entity.

**Relevance (0-10):** Does it answer the question that was asked?
  9-10: Every part serves the query. Right answer type.
  7-8:  Addresses core intent. Minor tangential content.
  5-6:  Right topic but wrong framing or answer type.
  3-4:  Same general domain, different question answered.
  1-2:  Shares keywords only. Different topic.
  0:    No connection between query and response.

=== IMPORTANT ===
- Use the FULL scoring range. A score of 5 indicates real problems.
- Score each dimension INDEPENDENTLY. High factuality does not imply high
  relevance. A response can be accurate but off-topic.
- The reference answer is ONE valid answer, not THE only valid answer. Do not
  penalize different wording, additional correct information, or different
  organization.
- Evaluate information density, not length. A concise correct answer is
  better than a verbose one padded with filler.

=== MATERIAL ===

<query>
{query}
</query>

<expected_answer>
{expected_answer}
</expected_answer>

<actual_response>
{actual_response}
</actual_response>

=== INSTRUCTIONS ===

1. Extract the key themes and factual claims from the expected answer
2. Check each against the actual response (covered / touched / missing)
3. Check for additional claims in the actual response (bonus vs hallucinated)
4. Score each dimension independently with reasoning

Respond in exactly this format:

THEME_COVERAGE:
- [theme]: [COVERED/TOUCHED/MISSING]
- ...

TASK_SUCCESS_REASONING: [2-3 sentences analyzing coverage and completeness]
TASK_SUCCESS: [0-10]

FACTUALITY_REASONING: [2-3 sentences on groundedness of claims]
FACTUALITY: [0-10]

RELEVANCE_REASONING: [2-3 sentences on query-response alignment]
RELEVANCE: [0-10]
```

### 5.2 Single-Criterion Deep Judge (Task Success)

When you need more reliable scoring on a single dimension. Higher cost, higher accuracy.

```xml
You are an expert evaluator assessing whether an AI agent successfully
completed a knowledge synthesis task.

=== CRITERION: TASK SUCCESS ===

You are measuring ONE thing: did the agent find and present the information
the user needed?

This is NOT about factual accuracy (scored separately).
This is NOT about relevance (scored separately).
This IS about: given what the user asked, how much of the needed
information did the agent deliver?

=== RUBRIC ===

Score 9-10: FULL SUCCESS
  All major themes from the reference answer are present in the response.
  The user could take action based solely on this response. No follow-up
  questions needed for the core task.

Score 7-8: SUBSTANTIAL SUCCESS
  Most key information present (75%+). One or two minor gaps that would
  prompt a follow-up question, but the response is directionally complete.

Score 5-6: PARTIAL SUCCESS
  Roughly half the expected information present. The user gets value but
  must supplement significantly. Key themes may be mentioned without
  enough detail to be actionable.

Score 3-4: MINIMAL SUCCESS
  Response touches on the topic but delivers little of the expected
  content. Generic or surface-level treatment where specifics were needed.

Score 1-2: NEAR FAILURE
  Response exists but does not meaningfully address the task.
  Answers a related but different question.

Score 0: COMPLETE FAILURE
  No response, refusal, error, or entirely wrong topic.

=== CALIBRATION EXAMPLES ===

Example A (Score: 9)
  Query: "What were the main themes from customer feedback on the Q3
  product release?"
  Expected: Should cover performance improvements (positive), UI
  confusion (negative), missing mobile features (negative), faster
  onboarding (positive)
  Response: "Based on customer feedback surveys and support tickets from
  Q3, four main themes emerged: (1) Users praised the 40% performance
  improvement in dashboard loading, with several enterprise customers
  noting this resolved their primary complaint. (2) The redesigned
  navigation confused existing users, generating 45 support tickets in
  the first two weeks. (3) Mobile users reported key workflows still
  missing from the app. (4) New customer onboarding time dropped from
  3 days to 4 hours, with 89% completion rates."
  Why 9: Covers all four expected themes with specific details.

Example B (Score: 5)
  Query: [same query]
  Expected: [same expected]
  Response: "Customers had mixed reactions to the Q3 release. Some
  users liked the performance improvements while others found the
  new interface confusing. There were also requests for better mobile
  support."
  Why 5: Mentions three of four themes but without any specifics.
  No data, no examples, not actionable. Touches on the right topics
  but at too shallow a level.

Example C (Score: 2)
  Query: [same query]
  Expected: [same expected]
  Response: "The Q3 product release included several new features
  including improved dashboards, a redesigned navigation system, and
  updates to the mobile app. The team worked hard to deliver these
  improvements on schedule."
  Why 2: Describes what was released, not customer feedback about it.
  Answers "what shipped" instead of "what did customers think."

=== MATERIAL ===

<query>
{query}
</query>

<expected_answer>
{expected_answer}
</expected_answer>

<actual_response>
{actual_response}
</actual_response>

=== INSTRUCTIONS ===

1. Decompose the expected answer into numbered key themes
2. For each theme, classify the actual response's coverage:
   COVERED (present with useful detail), TOUCHED (mentioned without
   depth), or MISSING (absent)
3. Note any additional correct content in the response not in the
   expected answer
4. Determine your score using the rubric and calibration examples

THEMES:
1. [theme from expected]: [COVERED/TOUCHED/MISSING]
2. ...

ADDITIONAL_CONTENT: [any correct content in response not in expected,
  or "None"]

REASONING: [3-4 sentences justifying your score with specific quotes]
SCORE: [0-10]
```

### 5.3 Factuality-Focused Claim Verification Judge

For when factual accuracy is the primary concern (e.g., compliance agents, policy Q&A).

```xml
You are a factual accuracy evaluator for an enterprise AI agent. Your job is
to verify whether the agent's claims are grounded in real data by comparing
them against a known-good reference answer.

=== WHAT YOU ARE CHECKING ===

A "factual claim" is any statement that asserts something specific is true:
- A number, percentage, or metric
- A date, timeline, or sequence of events
- A person, team, or department attribution
- A process, procedure, or policy description
- A cause-effect relationship

NOT factual claims (do not evaluate these):
- Hedged statements ("it appears that...", "possibly...")
- Meta-commentary ("Based on the available information...")
- Structural language ("First, let's look at...")
- Common knowledge not specific to the enterprise context

=== MATERIAL ===

<query>
{query}
</query>

<reference_answer>
{expected_answer}
</reference_answer>

<agent_response>
{actual_response}
</agent_response>

=== INSTRUCTIONS ===

1. Extract every factual claim from the agent's response
2. For each claim, compare against the reference answer:

   VERIFIED:     Claim matches the reference answer (same facts, possibly
                 different wording)
   IMPRECISE:    Claim is directionally correct but loses precision
                 (e.g., "about 20%" when reference says "18.7%")
   UNVERIFIABLE: Claim is not addressed in the reference answer
                 (could be correct from other sources, or fabricated)
   CONTRADICTED: Claim directly conflicts with the reference answer
   FABRICATED:   Claim includes specific details (names, numbers, dates)
                 not in the reference and unlikely from other sources

3. Compute the factuality profile
4. Score based on the profile

=== SCORING ===

Score 9-10: All claims VERIFIED or IMPRECISE. Zero CONTRADICTED or FABRICATED.
Score 7-8:  Majority VERIFIED. At most one IMPRECISE. Zero CONTRADICTED.
            Minor UNVERIFIABLE claims acceptable if plausible.
Score 5-6:  Mix of VERIFIED and UNVERIFIABLE. No CONTRADICTED claims,
            but significant content cannot be confirmed.
Score 3-4:  One or more CONTRADICTED or FABRICATED claims alongside
            some VERIFIED claims. The response is unreliable.
Score 1-2:  Multiple CONTRADICTED or FABRICATED claims. Core assertions
            are wrong.
Score 0:    Predominantly FABRICATED. No verified claims.

CLAIMS:
1. "[exact quote from response]" -> [VERIFIED/IMPRECISE/UNVERIFIABLE/
   CONTRADICTED/FABRICATED] (reference says: [what reference says, or
   "not addressed"])
2. ...

PROFILE: [X] verified, [Y] imprecise, [Z] unverifiable,
         [W] contradicted, [V] fabricated out of [total]

REASONING: [2-3 sentences on overall factual reliability]
SCORE: [0-10]
```

### 5.4 Lightweight Binary QA Judge

For fast pass/fail screening. Run this first, then run the detailed judges only on cases that pass.

```xml
You will be provided a query, an expected answer, and the agent's actual
response. Determine whether the agent's response is correct.

<query>{query}</query>

<expected_answer>{expected_answer}</expected_answer>

<actual_response>{actual_response}</actual_response>

An answer is correct if:
- It covers the main themes or facts described in the expected answer
- Its factual claims do not contradict the expected answer
- It addresses the question that was asked (not a different question)

An answer is incorrect if ANY of the following are true:
- It misses more than half the key themes from the expected answer
- It contains factual claims that contradict the expected answer
- It answers a substantially different question than what was asked
- It is a refusal, error message, or nonsensical output

Small differences in wording, structure, or emphasis do not make an answer
incorrect. Additional correct information beyond the expected answer does
not make it incorrect.

First, reason through your assessment in <thinking></thinking> tags.
Then provide your verdict in <correctness></correctness> tags as either
"correct" or "incorrect".
```

### 5.5 Comparative QA Judge (A/B Testing Agents)

When comparing two agent versions against the same expected answer.

```xml
You are comparing two AI agent responses to the same query. Both are
evaluated against a reference answer that defines what good looks like.

=== IMPORTANT ===
- Evaluate each response AGAINST THE REFERENCE, not against each other
- Score each independently first, then compare
- A response can be better than the other while still being poor overall

<query>{query}</query>

<reference_answer>{expected_answer}</reference_answer>

<response_a>{response_a}</response_a>

<response_b>{response_b}</response_b>

=== INSTRUCTIONS ===

Score each response independently on task_success (0-10) using this rubric:
  9-10: Covers all reference themes. Usable as-is.
  7-8:  Covers most themes (75%+). Minor gaps.
  5-6:  Covers about half. Significant supplementation needed.
  3-4:  Touches on topic. Mostly misses the mark.
  1-2:  Wrong question or extremely shallow.
  0:    Complete failure.

RESPONSE_A_REASONING: [2-3 sentences]
RESPONSE_A_SCORE: [0-10]

RESPONSE_B_REASONING: [2-3 sentences]
RESPONSE_B_SCORE: [0-10]

COMPARISON: [Which is better and why, in 1-2 sentences]
WINNER: [A / B / TIE]
```

---

## 6. Framework Patterns Worth Stealing

### 6.1 RAGAS Faithfulness (Claim Decomposition)

RAGAS breaks faithfulness evaluation into two LLM calls:

**Call 1 -- Claim extraction:**
```
Given a question and answer, create one or more statements from each
sentence in the given answer.

question: [input]
answer: [response]

Produce a list of individual factual statements.
```

**Call 2 -- Claim verification (per claim):**
```
Consider the given context and determine if the following statement
is supported by the information in the context.

context: [retrieved chunks]
statement: [single extracted claim]

Verdict: supported / not supported
```

Faithfulness = count(supported) / count(total claims)

**What to steal:** The two-pass approach. Separating claim extraction from claim verification reduces the cognitive load on each LLM call and improves reliability. The judge doesn't have to simultaneously find claims AND verify them.

**Adaptation for QA pairs:** Replace "retrieved context" with "expected answer" in the verification step. This gives you a RAGAS-style faithfulness score grounded against your reference rather than against retrieved documents.

### 6.2 RAGAS Answer Correctness (Semantic + Factual)

RAGAS answer_correctness combines two signals:

1. **Factual similarity** -- decompose both reference and response into statements, then classify each pair as TP (both have it), FP (response has it, reference doesn't), FN (reference has it, response doesn't). Compute an F1-like score.

2. **Semantic similarity** -- embedding-based cosine similarity between response and reference.

Final score = weighted_sum(factual_similarity, semantic_similarity)

**What to steal:** The TP/FP/FN framing. This is the cleanest way to handle partial matches:
- **TP (true positive):** Theme is in both expected and actual
- **FP (false positive):** Theme is in actual but not expected (could be bonus correct info or hallucination)
- **FN (false negative):** Theme is in expected but missing from actual

This maps directly to precision (how much of what the agent said was correct?) and recall (how much of what it should have said did it actually say?).

### 6.3 OpenEvals / LangChain Correctness Prompt

OpenEvals (LangChain) uses a straightforward template:

```
You are an expert data labeler evaluating model outputs for correctness.
Your task is to assign a score based on the following rubric:

<Rubric>
A correct answer:
- Provides accurate and complete information
...
</Rubric>

<input>{inputs}</input>
<output>{outputs}</output>
<reference_output>{reference_outputs}</reference_output>
```

**What to steal:** The simplicity. For binary correctness (pass/fail), you don't need a complex rubric. The OpenEvals approach uses a single-paragraph rubric with `inputs`, `outputs`, and `reference_outputs` as the three variables. Clean and effective for initial screening.

### 6.4 Braintrust AutoEvals Factuality

AutoEvals runs a factuality check with a simple interface:

```python
evaluator = Factuality()
result = evaluator(output, expected, input=input)
# Returns score (0-1), rationale
```

Under the hood, the prompt asks the judge to classify the relationship:
- (A) Output is a subset of expected (correct but incomplete)
- (B) Output is a superset of expected (correct with extras)
- (C) Output and expected disagree
- (D) Output and expected differ but are not contradictory
- (E) Output and expected are equivalent

**What to steal:** The categorical classification of the relationship BEFORE scoring. By first classifying the relationship type, the judge anchors its reasoning. A "subset" relationship maps to a partial-success score; a "disagree" relationship maps to a factuality failure. This prevents the judge from trying to simultaneously classify and score.

### 6.5 G-Eval Form-Filling

G-Eval's key insight is generating evaluation steps as chain-of-thought before scoring:

```
Task: Evaluate the coherence of a summary.

Evaluation Steps:
1. Read the summary carefully
2. Check if all sentences connect logically
3. Identify any abrupt topic changes
4. Check if the summary follows a clear structure
5. Assign a score from 1-5

[The LLM generates these steps, then uses them to evaluate]
```

**What to steal:** For complex criteria, ask the judge to GENERATE the evaluation steps before applying them. This is more expensive (two LLM calls) but produces more consistent scoring because the evaluation methodology is explicit rather than implicit.

**Practical approximation:** Instead of having the model generate steps, provide them in the prompt (which is what the templates in Section 5 do). You lose the adaptivity but gain determinism.

### 6.6 Anthropic's Binary Grader with XML

From Anthropic's `building_evals.ipynb`:

```python
"""You will be provided an answer that an assistant gave to a question,
and a rubric that instructs you on what makes the answer correct or incorrect.

Here is the answer that the assistant gave to the question.
<answer>{answer}</answer>

Here is the rubric on what makes the answer correct or incorrect.
<rubric>{rubric}</rubric>

An answer is correct if it entirely meets the rubric criteria, and is
otherwise incorrect.
First, think through whether the answer is correct or incorrect based on
the rubric inside <thinking></thinking> tags. Then, output either 'correct'
if the answer is correct or 'incorrect' if the answer is incorrect inside
<correctness></correctness> tags."""
```

**What to steal:**
- Thinking tags before verdict tags (force CoT)
- The rubric IS the expected answer (rubric contains criteria, not the exact answer)
- Parsing targets `<correctness>` tags, ignoring everything in `<thinking>`
- Binary framing forces a decision -- no hedge-able middle ground

---

## 7. Anti-Patterns

### 7.1 Showing Actual Before Expected

```
BAD:
  Here is the agent's response: [response]
  Here is what the answer should look like: [expected]

GOOD:
  Here is what a good answer looks like: [expected]
  Here is the agent's response: [expected]
```

When the judge reads the actual response first, it forms a quality impression before seeing the standard. This impression anchors subsequent scoring. Show the reference frame first.

### 7.2 Treating Expected as Exact Match Target

```
BAD:
  "Score how closely the response matches the expected answer."
  "Compare the response word-for-word with the expected answer."

GOOD:
  "The expected answer describes the key information a good response
   should contain. Different wording, structure, and additional correct
   information are acceptable."
```

String similarity is not quality assessment. Two responses can be semantically identical with zero word overlap.

### 7.3 Using a Bare Numeric Scale

```
BAD:
  "Rate the response quality from 1 to 10."

GOOD:
  "Rate the response quality from 1 to 10 using this rubric:
   9-10: [specific observable criteria]
   7-8: [specific observable criteria]
   ..."
```

Without anchored scale points, every evaluator has a different mental model of what "7" means. Define it.

### 7.4 Scoring Multiple Dimensions in One Number

```
BAD:
  "Considering accuracy, relevance, completeness, and style, give
   an overall quality score from 1-10."

GOOD:
  Score each dimension independently:
  - Accuracy: [0-10]
  - Relevance: [0-10]
  - Completeness: [0-10]
  Aggregate in code, not in the judge's head.
```

When you ask for one number that combines multiple dimensions, the judge implicitly weights them -- and you don't know how. Decompose and aggregate programmatically.

### 7.5 Not Specifying What "5/10" Means

```
BAD:
  Score 5: Average quality

GOOD:
  Score 5: Response covers roughly half the expected content. It has
  real value but requires significant supplementation. Key themes may
  be mentioned without enough detail to be actionable.
```

"Average" is meaningless. LLM judges default to 7-8/10 for anything that isn't obviously terrible. You have to define midpoint and below with concrete descriptions to get judges to actually use the full range.

### 7.6 Score-Then-Reason Ordering

```
BAD:
  SCORE: [number]
  REASONING: [why]

GOOD:
  REASONING: [analysis]
  SCORE: [number]
```

When the score comes first, reasoning becomes post-hoc justification. When reasoning comes first, the model commits to an analytical position before quantifying it. G-Eval showed this improves human correlation by 10-20%.

### 7.7 Ignoring Judge Calibration

```
BAD:
  Build judge -> run evals -> trust scores

GOOD:
  Build judge -> test on known-good and known-bad cases -> verify
  distribution -> adjust rubric -> THEN run real evals
```

Before trusting a judge, run it on 10-20 cases where you already know the quality. Include at least:
- 3 clearly excellent responses (should score 8-10)
- 3 clearly poor responses (should score 1-4)
- 4 ambiguous middle cases

If the judge scores the bad cases above 6 or the good cases below 7, the rubric needs work.

### 7.8 Same Model Judges Itself

```
BAD:
  Agent model: Claude Sonnet -> Judge model: Claude Sonnet

BETTER:
  Agent model: Claude Sonnet -> Judge model: Claude Opus
  Agent model: Glean's model -> Judge model: Claude (any)
```

Models show 5-15% higher scores when judging their own family's output. Use a different (ideally stronger) model for judging. In Seer's case, agents run through Glean's infrastructure, so using Claude as the judge already provides natural cross-model separation.

### 7.9 No Anti-Verbosity Instructions

```
BAD:
  [no mention of length]

GOOD:
  "Evaluate information density, not length. A concise correct answer
   is BETTER than a verbose one that pads with obvious or redundant
   information. Do not reward length."
```

LLM judges have a measured 10-20% scoring advantage for longer responses. Explicitly counter this.

### 7.10 Binary Expected Answers for Synthesis Tasks

```
BAD:
  expected_answer: "The new onboarding flow reduced time-to-value by 50%"
  (exact factoid that demands exact match)

GOOD:
  expected_answer: "The response should describe the impact of the new
  onboarding flow, including quantitative improvement in time-to-value
  (approximately 50% reduction) and qualitative feedback from users about
  the simplified process."
```

For synthesis tasks, the expected answer should describe WHAT topics to cover and WHAT facts to include, not provide the exact sentence the agent should produce. Write expected answers as specifications, not as strings.

---

## 8. Implementation Notes for Seer

### 8.1 Current State

Seer's `judge.ts` currently:
- Uses CoT-then-score ordering (good)
- Presents expected answer before actual response in the prompt (good)
- Uses `REASONING:` / `SCORE:` format for parsing (works, but XML tags would be more reliable)
- Evaluates one criterion at a time (accurate but expensive)

### 8.2 Recommended Changes

**1. Adopt the multi-dimension template (Section 5.1) for batch scoring.**

Replace separate criterion calls with the batch template for the standard three dimensions (task_success, factuality, relevance). This cuts API calls by 3x while maintaining reasonable independence.

```typescript
// Current: 3 separate calls
await judgeResponse(taskSuccessCriterion, query, response, result, expected)
await judgeResponse(factualityCriterion, query, response, result, expected)
await judgeResponse(relevanceCriterion, query, response, result, expected)

// Proposed: 1 call with multi-dimension template
await judgeResponseBatch(query, response, expected, ['task_success', 'factuality', 'relevance'])
```

**2. Add theme decomposition to the prompt.**

The current prompt says "provide your reasoning in 2-3 sentences" but doesn't ask the judge to decompose the expected answer into themes first. Adding the `THEME_COVERAGE` step (Section 5.1) forces systematic analysis rather than holistic impression.

**3. Add calibration examples to continuous criteria.**

The current rubrics describe score ranges but don't include concrete examples. Adding 2-3 pre-scored examples per criterion (like Section 5.2) is the single highest-impact improvement for score consistency.

**4. Upgrade parsing to handle XML tags.**

The current regex parsing (`/SCORE:\s*(\d+)/`) is fragile. If the judge's reasoning mentions a number before the SCORE line, it can mismatch. XML-tagged output (`<score>7</score>`) is more robust.

```typescript
// Current
const scoreMatch = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i)

// Proposed
const scoreMatch = text.match(/<task_success>(\d+(?:\.\d+)?)<\/task_success>/)
```

**5. Add the lightweight binary pre-screen (Section 5.4).**

Before running expensive multi-dimension scoring, run the binary judge first. Cases that clearly pass or clearly fail can be fast-tracked. Only ambiguous cases need the full scoring pipeline.

### 8.3 Expected Answer Guidelines for Eval Set Authors

When writing expected answers for Seer eval cases:

1. **Write specifications, not sentences.** Describe what the response should contain, not the exact response.

2. **Tag importance.** Mark critical themes vs. nice-to-have themes so the judge can weight appropriately.

3. **Include specific verifiable facts.** The expected answer should contain the specific numbers, names, or dates that the agent should find, so the factuality judge has something to verify against.

4. **Describe what a wrong answer looks like.** If there's a common failure mode (e.g., the agent confuses Product A with Product B), note it so the judge can check.

Example of a well-written expected answer:

```
The response should cover:
- [CRITICAL] Total ARR growth in Q4 was 23% YoY ($45.2M -> $55.6M)
- [CRITICAL] Enterprise segment drove most of the growth (31% of new ARR)
- [IMPORTANT] SMB churn offset some gains (net negative $2.1M)
- [IMPORTANT] Three new enterprise logos closed (Acme Corp, Beta Inc, Gamma Ltd)
- [SUPPLEMENTARY] Pipeline for Q1 is 2.3x target
- [WATCH FOR] Agent may confuse Q4 with full-year numbers
```

---

*This guide provides prompt templates and scoring calibration specifically for QA pair evaluation of knowledge synthesis agents. It builds on the patterns documented in `guide-judge-best-practices.md` (general LLM-as-judge methodology) and `guide-petri-judge-patterns.md` (Anthropic's judge prompting patterns). Frameworks referenced: RAGAS, OpenEvals, Braintrust AutoEvals, G-Eval.*

-- Axon | 2026-02-13
