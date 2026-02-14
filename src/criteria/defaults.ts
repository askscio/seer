/**
 * Evaluation dimensions for enterprise knowledge agents
 *
 * Organized by evaluation method:
 * - Coverage (reference-based): compared against expected answer
 * - Faithfulness (reference-free): checked against agent's own retrieval
 * - Factuality (search-verified): verified via live company search
 * - Metrics (direct): measured from execution data
 */

export interface CriterionDefinition {
  id: string
  name: string
  description: string
  rubric: string
  scoreType: 'binary' | 'categorical' | 'continuous' | 'metric'
  judgeCall: 'coverage' | 'faithfulness' | 'factuality' | 'metric'
  scaleConfig?: {
    type?: '0-10'
    categories?: string[]
    metricExtractor?: string
  }
  weight: number
}

export const DEFAULT_CRITERIA: CriterionDefinition[] = [

  // ===== COVERAGE (reference-based — Call 1) =====

  {
    id: 'topical_coverage',
    name: 'Topical Coverage',
    description: 'How many of the expected themes does the response address?',
    rubric: `Decompose the expected answer into discrete themes. For each theme, classify the response's coverage as COVERED (present with useful detail), TOUCHED (mentioned without depth), or MISSING (absent).

Score 9-10: All major themes COVERED. User could act on this response alone.
Score 7-8:  Most themes COVERED (75%+). One or two minor gaps that would prompt a follow-up.
Score 5-6:  About half the themes covered. Real value but needs significant supplementation.
Score 3-4:  Touches on the topic but delivers little expected content. Generic where specifics were needed.
Score 1-2:  Answers a related but different question. Minimal theme overlap.
Score 0:    Complete failure, refusal, error, or entirely wrong topic.

IMPORTANT: The expected answer describes themes to cover, not exact text to match. Different wording, structure, and additional correct information are acceptable. Do not penalize semantic equivalents.`,
    scoreType: 'continuous',
    judgeCall: 'coverage',
    scaleConfig: { type: '0-10' },
    weight: 1.0,
  },

  {
    id: 'response_quality',
    name: 'Response Quality',
    description: 'Is the output well-structured, concise, actionable, and in the right format?',
    rubric: `Evaluate the quality of the response independent of factual content.

Score 9-10: Clear structure, concise, actionable. Uses specific language (not boilerplate). Appropriate format for the task (bullets for lists, paragraphs for explanations).
Score 7-8:  Good structure and mostly concise. Minor formatting or organizational issues.
Score 5-6:  Understandable but poorly organized. May be too verbose, too terse, or use the wrong format.
Score 3-4:  Hard to parse. Wall of text, jumbled structure, or significant formatting problems.
Score 1-2:  Nearly unusable output format.
Score 0:    No meaningful output.

Evaluate information density, not length. A concise correct answer is BETTER than a verbose one padded with filler.`,
    scoreType: 'continuous',
    judgeCall: 'coverage',
    scaleConfig: { type: '0-10' },
    weight: 0.7,
  },

  // ===== FAITHFULNESS (reference-free — Call 2) =====

  {
    id: 'groundedness',
    name: 'Groundedness',
    description: 'Are the response claims supported by the documents the agent actually retrieved?',
    rubric: `You will be given the agent's reasoning chain (search queries executed, documents read). Check whether each claim in the response is supported by those sources.

Score 9-10: All substantive claims traceable to retrieved documents. Response is a faithful synthesis of what was found.
Score 7-8:  Most claims supported. One or two minor assertions lack clear source backing but are plausible.
Score 5-6:  Mix of grounded and ungrounded claims. Some content appears synthesized from sources, some appears assumed.
Score 3-4:  Many claims have no clear source in the retrieved documents. Response reads more like general knowledge than grounded synthesis.
Score 1-2:  Response appears disconnected from what was actually retrieved.
Score 0:    No relationship between response content and retrieved sources.

NOTE: You are checking whether the response is faithful to what the agent FOUND — not whether what it found is correct (that's factual accuracy, scored separately).`,
    scoreType: 'continuous',
    judgeCall: 'faithfulness',
    scaleConfig: { type: '0-10' },
    weight: 1.0,
  },

  {
    id: 'hallucination_risk',
    name: 'Hallucination Risk',
    description: 'Does the response contain specific claims without source backing?',
    rubric: `Check for hallucination signals: specific details (names, numbers, dates, metrics, percentages) that are NOT supported by the agent's retrieved documents.

- yes (no hallucination detected): All specific claims have source backing in the reasoning chain, OR the response appropriately hedges unsupported claims.
- no (hallucination detected): Response asserts specific details that cannot be traced to any retrieved document. Flag the specific claims.

A response that says "no data found" when no relevant documents were retrieved is CORRECT behavior, not a failure.`,
    scoreType: 'binary',
    judgeCall: 'faithfulness',
    scaleConfig: {},
    weight: 0.8,
  },

  // ===== FACTUALITY (search-verified — Call 3, optional) =====

  {
    id: 'factual_accuracy',
    name: 'Factual Accuracy',
    description: 'Are the specific claims actually true according to current company data?',
    rubric: `Using your access to company search tools, independently verify the key factual claims in the agent's response.

For each claim, classify as:
- VERIFIED: Matches current data
- IMPRECISE: Directionally correct but loses precision
- UNVERIFIABLE: Not addressed in searchable data
- CONTRADICTED: Conflicts with current data
- FABRICATED: Specific details that don't exist anywhere

Score 9-10: All verifiable claims VERIFIED or IMPRECISE. Zero CONTRADICTED or FABRICATED.
Score 7-8:  Majority VERIFIED. At most one IMPRECISE. Zero CONTRADICTED.
Score 5-6:  Mix of VERIFIED and UNVERIFIABLE. No CONTRADICTED but significant content cannot be confirmed.
Score 3-4:  One or more CONTRADICTED or FABRICATED claims alongside some VERIFIED claims.
Score 1-2:  Multiple CONTRADICTED or FABRICATED claims. Core assertions are wrong.
Score 0:    Predominantly FABRICATED. No verified claims.`,
    scoreType: 'continuous',
    judgeCall: 'factuality',
    scaleConfig: { type: '0-10' },
    weight: 1.0,
  },

  // ===== METRICS (direct measurement — no judge) =====

  {
    id: 'latency',
    name: 'Latency',
    description: 'End-to-end response time',
    rubric: 'Measured in milliseconds from API call to response',
    scoreType: 'metric',
    judgeCall: 'metric',
    scaleConfig: { metricExtractor: 'latencyMs' },
    weight: 0.3,
  },

  {
    id: 'tool_call_count',
    name: 'Tool Calls',
    description: 'Number of tools invoked during execution',
    rubric: 'Count of tool invocations (Search, Think, Generate, etc.)',
    scoreType: 'metric',
    judgeCall: 'metric',
    scaleConfig: { metricExtractor: 'toolCallCount' },
    weight: 0.1,
  },
]

export function getCriterion(id: string): CriterionDefinition | undefined {
  return DEFAULT_CRITERIA.find(c => c.id === id)
}

export function getCriteriaByCall(call: 'coverage' | 'faithfulness' | 'factuality' | 'metric'): CriterionDefinition[] {
  return DEFAULT_CRITERIA.filter(c => c.judgeCall === call)
}
