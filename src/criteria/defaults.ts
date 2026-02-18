/**
 * Evaluation dimensions for enterprise knowledge agents
 *
 * Organized by evaluation method:
 * - Coverage (reference-based): compared against expected answer
 * - Faithfulness (reference-free): checked against agent's own retrieval
 * - Factuality (search-verified): verified via live company search
 * - Metrics (direct): measured from execution data
 *
 * Uses categorical scales (not continuous) per I/O psychology SJT research
 * showing 15% reliability gain and 37% validity gain over continuous scales.
 */

export interface CriterionDefinition {
  id: string
  name: string
  description: string
  rubric: string
  scoreType: 'binary' | 'categorical' | 'metric'
  judgeCall: 'coverage' | 'faithfulness' | 'factuality' | 'metric'
  scaleConfig?: {
    categories?: string[]
    categoryValues?: Record<string, number>  // Map categories to numeric values for aggregation
    metricExtractor?: string
  }
  weight: number
}

// Standard 5-level category scale with numeric mapping
const QUALITY_CATEGORIES = ['full', 'substantial', 'partial', 'minimal', 'failure']
const QUALITY_VALUES: Record<string, number> = {
  full: 10,
  substantial: 7.5,
  partial: 5,
  minimal: 2.5,
  failure: 0,
}

export const DEFAULT_CRITERIA: CriterionDefinition[] = [

  // ===== COVERAGE (reference-based — Call 1) =====

  {
    id: 'topical_coverage',
    name: 'Topical Coverage',
    description: 'How many of the expected themes does the response address?',
    rubric: `Decompose the expected answer into discrete themes. For each theme, classify the response's coverage as COVERED (present with useful detail), TOUCHED (mentioned without depth), or MISSING (absent). Then assign a category:

- full: All major themes COVERED. User could act on this alone. No follow-up needed.
- substantial: Most themes COVERED (75%+). One or two minor gaps.
- partial: About half the themes covered. Real value but needs supplementation.
- minimal: Touches on the topic but delivers little expected content. Generic where specifics were needed.
- failure: Wrong topic, refusal, error, or no meaningful overlap with expected themes.

The expected answer describes themes to cover, not exact text to match. Different wording, structure, and additional correct information are acceptable.`,
    scoreType: 'categorical',
    judgeCall: 'coverage',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  {
    id: 'response_quality',
    name: 'Response Quality',
    description: 'Is the output well-structured, concise, actionable, and in the right format?',
    rubric: `Evaluate the quality of the response independent of factual content:

- full: Clear structure, concise, actionable. Specific language (not boilerplate). Appropriate format.
- substantial: Good structure and mostly concise. Minor formatting or organizational issues.
- partial: Understandable but poorly organized. Too verbose, too terse, or wrong format.
- minimal: Hard to parse. Wall of text, jumbled structure, or significant formatting problems.
- failure: Unusable output format or no meaningful output.

Evaluate information density, not length. A concise correct answer is BETTER than a verbose padded one.`,
    scoreType: 'categorical',
    judgeCall: 'coverage',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 0.7,
  },

  // ===== FAITHFULNESS (reference-free — Call 2) =====

  {
    id: 'groundedness',
    name: 'Groundedness',
    description: 'Are the response claims supported by the documents the agent actually retrieved?',
    rubric: `You will be given the agent's reasoning chain (search queries executed, documents read). Check whether each claim in the response is supported by those sources. Then assign a category:

- full: All substantive claims traceable to retrieved documents. Faithful synthesis.
- substantial: Most claims supported. One or two assertions lack clear source backing but are plausible.
- partial: Mix of grounded and ungrounded claims. Some from sources, some assumed.
- minimal: Many claims have no clear source. Reads more like general knowledge than grounded synthesis.
- failure: Response disconnected from retrieved sources.

You are checking whether the response is faithful to what the agent FOUND — not whether what it found is correct.`,
    scoreType: 'categorical',
    judgeCall: 'faithfulness',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  {
    id: 'hallucination_risk',
    name: 'Hallucination Risk',
    description: 'Does the response contain specific claims without source backing?',
    rubric: `Check for hallucination signals: specific details (names, numbers, dates, metrics) NOT supported by the agent's retrieved documents.

- yes (no hallucination detected): All specific claims have source backing, OR response appropriately hedges.
- no (hallucination detected): Response asserts specific unsupported details. Flag the claims.

A response that says "no data found" when no documents were retrieved is CORRECT behavior.`,
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
    rubric: `Using your company search tools, independently verify the key factual claims. For each claim, classify and cite your source:

- VERIFIED (source: [document/system you found it in])
- IMPRECISE (source: [what you found — directionally correct, details differ])
- UNVERIFIABLE (searched [where] — not addressed)
- CONTRADICTED (source: [document] says [what it actually says])
- FABRICATED (searched [where] — details don't exist anywhere)

Then assign a category:
- full: All verifiable claims VERIFIED or IMPRECISE. Zero CONTRADICTED/FABRICATED.
- substantial: Majority VERIFIED. At most one IMPRECISE. Zero CONTRADICTED.
- partial: Mix of VERIFIED and UNVERIFIABLE. No CONTRADICTED but significant unconfirmed content.
- minimal: One or more CONTRADICTED/FABRICATED alongside some VERIFIED.
- failure: Multiple CONTRADICTED/FABRICATED. Core assertions wrong.`,
    scoreType: 'categorical',
    judgeCall: 'factuality',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  // ===== METRICS (direct measurement) =====

  {
    id: 'latency',
    name: 'Latency',
    description: 'End-to-end response time',
    rubric: 'Measured in milliseconds',
    scoreType: 'metric',
    judgeCall: 'metric',
    scaleConfig: { metricExtractor: 'latencyMs' },
    weight: 0.3,
  },

  {
    id: 'tool_call_count',
    name: 'Tool Calls',
    description: 'Number of tools invoked during execution',
    rubric: 'Count of tool invocations',
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

/**
 * Convert a categorical score to its numeric value for aggregation
 */
export function categoryToNumeric(criterion: CriterionDefinition, category: string): number {
  return criterion.scaleConfig?.categoryValues?.[category.toLowerCase()] ?? 0
}
