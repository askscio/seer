/**
 * Evaluation dimensions for enterprise knowledge agents
 *
 * Organized by evaluation method:
 * - Coverage (reference-based): compared against eval guidance themes
 * - Faithfulness (source-grounded): checked against agent's retrieved documents
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
  judgeCall: 'coverage' | 'quality' | 'faithfulness' | 'factuality' | 'golden' | 'metric' | 'custom'
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
    rubric: `Decompose the eval guidance into discrete themes. For each theme, classify the response's coverage as COVERED (present with useful detail), TOUCHED (mentioned without depth), or MISSING (absent). Then assign a category:

- full: All major themes COVERED. User could act on this alone. No follow-up needed.
- substantial: Most themes COVERED (75%+). One or two minor gaps.
- partial: About half the themes covered. Real value but needs supplementation.
- minimal: Touches on the topic but delivers little guided content. Generic where specifics were needed.
- failure: Wrong topic, refusal, error, or no meaningful overlap with guided themes.

The eval guidance describes themes to cover, not exact text to match. Different wording, structure, and additional correct information are acceptable.`,
    scoreType: 'categorical',
    judgeCall: 'coverage',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  {
    id: 'answer_accuracy',
    name: 'Answer Accuracy',
    description: 'Are the response claims accurate against the provided golden answer and sources?',
    rubric: `Use the golden answer and golden sources as the reference. Check factual and semantic correctness of substantive claims in the response:

- full: All key claims are accurate and consistent with the golden answer/sources.
- substantial: Mostly accurate; minor imprecision that does not change the core meaning.
- partial: Mix of accurate and inaccurate/imprecise claims; user would need corrections.
- minimal: Multiple incorrect or contradictory claims relative to golden references.
- failure: Core answer is wrong, contradictory, or unrelated to golden references.

Allow wording differences, but do not allow factual contradictions.`,
    scoreType: 'categorical',
    judgeCall: 'golden',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  {
    id: 'answer_completeness',
    name: 'Answer Completeness',
    description: 'Does the response cover the required claims from the golden answer?',
    rubric: `Decompose the golden answer into required claims/themes, then assess whether the response covers them:

- full: Covers all required claims with sufficient detail.
- substantial: Covers most required claims (about 75%+), minor omissions only.
- partial: Covers around half the required claims; notable gaps remain.
- minimal: Mentions only a few required claims with limited substance.
- failure: Misses most required claims or fails to answer the question.

Do not require exact phrasing; evaluate coverage of required substance.`,
    scoreType: 'categorical',
    judgeCall: 'golden',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 1.0,
  },

  {
    id: 'citation_correctness',
    name: 'Citation Correctness',
    description: 'Did the agent cite or rely on the correct source(s) compared to the golden source list?',
    rubric: `Compare the URLs the agent actually cited or read (agent_cited_sources / agent_retrieved_sources, when provided) against the golden_sources list.

Citation correctness is NOT strict URL match. Allow partial credit when the agent cites a different version, a parent folder, or a closely related authoritative document. Penalize unrelated sources, missing citations, or citations from non-authoritative origins.

- full: Agent cites at least one golden source URL exactly, OR cites the same authoritative document via an equivalent URL (e.g., same SharePoint doc, different version/anchor) and no clearly wrong sources.
- substantial: Agent cites a closely related document from the same authoritative location/site/folder (e.g., same SharePoint site or same process area) — directionally correct source.
- partial: Agent cites a related but secondary source (different doc but topically related to the golden source), or cites the right source alongside several unrelated ones.
- minimal: Agent cites unrelated sources, or no clear citation overlap with the golden source.
- failure: Agent cites contradictory / wrong / non-authoritative sources, or no sources at all when the golden answer requires sourcing.

If no agent_cited_sources or agent_retrieved_sources are provided, fall back to checking whether the response text itself references or quotes the golden source's content.`,
    scoreType: 'categorical',
    judgeCall: 'golden',
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
    judgeCall: 'quality',
    scaleConfig: { categories: QUALITY_CATEGORIES, categoryValues: QUALITY_VALUES },
    weight: 0.7,
  },

  // ===== FAITHFULNESS (source-grounded — Call 3) =====

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

- low: All specific claims have source backing, OR response appropriately hedges uncertain details. No fabricated specifics.
- medium: Some specific claims lack clear source backing, but core points are grounded. Minor unsupported details that don't change the overall message.
- high: Multiple specific unsupported details (names, numbers, dates, metrics) asserted confidently without source backing. Core claims may be fabricated.

A response that says "no data found" when no documents were retrieved is CORRECT behavior (= low risk).`,
    scoreType: 'categorical',
    judgeCall: 'faithfulness',
    scaleConfig: {
      categories: ['low', 'medium', 'high'],
      categoryValues: { low: 10, medium: 5, high: 0 },
    },
    weight: 0.8,
  },

  // ===== FACTUALITY (search-verified — Call 4, deep mode only) =====

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
    weight: 0,  // Metrics are excluded from overall score — displayed separately
  },

  {
    id: 'tool_call_count',
    name: 'Tool Calls',
    description: 'Number of tools invoked during execution',
    rubric: 'Count of tool invocations',
    scoreType: 'metric',
    judgeCall: 'metric',
    scaleConfig: { metricExtractor: 'toolCallCount' },
    weight: 0,  // Metrics are excluded from overall score — displayed separately
  },
]

export function getCriterion(id: string): CriterionDefinition | undefined {
  return DEFAULT_CRITERIA.find(c => c.id === id)
}

export function getCriteriaByCall(
  call: 'coverage' | 'quality' | 'faithfulness' | 'factuality' | 'golden' | 'metric'
): CriterionDefinition[] {
  return DEFAULT_CRITERIA.filter(c => c.judgeCall === call)
}

/**
 * Convert a categorical score to its numeric value for aggregation
 */
export function categoryToNumeric(criterion: CriterionDefinition, category: string): number {
  return criterion.scaleConfig?.categoryValues?.[category.toLowerCase()] ?? 0
}
