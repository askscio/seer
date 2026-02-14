/**
 * LLM-as-judge implementation using three-call architecture:
 *
 * Call 1 (Coverage):     Reference-based — scores against expected answer
 * Call 2 (Faithfulness): Reference-free — scores against agent's own retrieval
 * Call 3 (Factuality):   Search-verified — ADVANCED agent verifies claims
 *
 * All calls use Opus 4.6 via raw fetch (SDK doesn't support modelSetId).
 */

import { config } from './config'
import type { CriterionDefinition } from '../criteria/defaults'
import type { JudgeScore, AgentResult } from '../types'
import { extractMetric } from './metrics'

const JUDGE_MODEL = 'opus-4-6'

// ===== Core judge function =====

/**
 * Judge a response — routes to the appropriate call based on criterion's judgeCall
 */
export async function judgeResponse(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer?: string,
): Promise<JudgeScore> {
  if (criterion.judgeCall === 'metric') {
    return extractMetric(criterion, agentResult)
  }

  if (criterion.judgeCall === 'coverage') {
    return judgeCoverage(criterion, query, response, expectedAnswer)
  }

  if (criterion.judgeCall === 'faithfulness') {
    return judgeFaithfulness(criterion, query, response, agentResult.reasoningChain)
  }

  if (criterion.judgeCall === 'factuality') {
    return judgeFactuality(criterion, query, response)
  }

  throw new Error(`Unknown judgeCall: ${criterion.judgeCall}`)
}

/**
 * Batch judge — scores multiple criteria in fewer calls by grouping by judgeCall
 */
export async function judgeResponseBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer?: string,
): Promise<JudgeScore[]> {
  const scores: JudgeScore[] = []

  // Group criteria by judgeCall type
  const coverageCriteria = criteria.filter(c => c.judgeCall === 'coverage')
  const faithfulnessCriteria = criteria.filter(c => c.judgeCall === 'faithfulness')
  const factualityCriteria = criteria.filter(c => c.judgeCall === 'factuality')
  const metricCriteria = criteria.filter(c => c.judgeCall === 'metric')

  // Metrics — no judge needed
  for (const c of metricCriteria) {
    scores.push(extractMetric(c, agentResult))
  }

  // Call 1: Coverage (batch all coverage criteria in one call)
  if (coverageCriteria.length > 0) {
    const coverageScores = await judgeCoverageBatch(coverageCriteria, query, response, expectedAnswer)
    scores.push(...coverageScores)
  }

  // Call 2: Faithfulness (batch all faithfulness criteria in one call)
  if (faithfulnessCriteria.length > 0) {
    const faithScores = await judgeFaithfulnessBatch(faithfulnessCriteria, query, response, agentResult.reasoningChain)
    scores.push(...faithScores)
  }

  // Call 3: Factuality (separate call with company tools)
  for (const c of factualityCriteria) {
    const score = await judgeFactuality(c, query, response)
    scores.push(score)
  }

  return scores
}

// ===== Call 1: Coverage Judge (reference-based) =====

async function judgeCoverage(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  expectedAnswer?: string,
): Promise<JudgeScore> {
  const scores = await judgeCoverageBatch([criterion], query, response, expectedAnswer)
  return scores[0]
}

async function judgeCoverageBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  expectedAnswer?: string,
): Promise<JudgeScore[]> {
  const criteriaBlock = criteria.map(c =>
    `=== ${c.id.toUpperCase()} ===\n${c.name}: ${c.description}\n\nRubric:\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c => {
    if (c.scoreType === 'continuous') return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[0-10]</${c.id}>`
    if (c.scoreType === 'binary') return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[yes or no]</${c.id}>`
    return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[value]</${c.id}>`
  }).join('\n\n')

  const prompt = `You are an expert evaluator assessing an AI agent's response against a reference answer.

${criteriaBlock}

=== MATERIAL ===

<query>
${query}
</query>

${expectedAnswer ? `<expected_answer>
${expectedAnswer}
</expected_answer>

` : ''}<actual_response>
${response}
</actual_response>

=== INSTRUCTIONS ===

${expectedAnswer ? `1. Extract the key themes from the expected answer
2. For each theme, classify the actual response's coverage: COVERED / TOUCHED / MISSING
3. Score each dimension independently using its rubric
` : `1. Evaluate the response directly against the query
2. Score each dimension independently using its rubric
`}
The expected answer is ONE valid answer, not THE only valid answer. Do not penalize different wording, additional correct information, or different organization. Evaluate information density, not length.

Respond in exactly this format:

<theme_coverage>
- [theme]: [COVERED/TOUCHED/MISSING]
</theme_coverage>

${scoreFormat}`

  const text = await callJudge(prompt)
  return criteria.map(c => parseScore(text, c))
}

// ===== Call 2: Faithfulness Judge (reference-free) =====

async function judgeFaithfulness(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  reasoningChain?: any[],
): Promise<JudgeScore> {
  const scores = await judgeFaithfulnessBatch([criterion], query, response, reasoningChain)
  return scores[0]
}

async function judgeFaithfulnessBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  reasoningChain?: any[],
): Promise<JudgeScore[]> {
  // Format reasoning chain for the judge
  const chainText = formatReasoningChain(reasoningChain)

  const criteriaBlock = criteria.map(c =>
    `=== ${c.id.toUpperCase()} ===\n${c.name}: ${c.description}\n\nRubric:\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c => {
    if (c.scoreType === 'continuous') return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[0-10]</${c.id}>`
    if (c.scoreType === 'binary') return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[yes or no]</${c.id}>`
    return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[value]</${c.id}>`
  }).join('\n\n')

  const prompt = `You are evaluating whether an AI agent's response is faithful to the documents it actually retrieved. You are NOT checking if the documents are correct — only whether the response accurately represents what was found.

${criteriaBlock}

=== MATERIAL ===

<query>
${query}
</query>

<reasoning_chain>
${chainText || 'No reasoning chain available.'}
</reasoning_chain>

<actual_response>
${response}
</actual_response>

=== INSTRUCTIONS ===

1. Identify the key claims in the actual response
2. For each claim, check if it's supported by the documents in the reasoning chain
3. Score each dimension independently

A response that says "no data found" when no documents were retrieved is CORRECT, not a failure.

Respond in exactly this format:

<claim_check>
- "[claim]": [GROUNDED/UNGROUNDED/HEDGED]
</claim_check>

${scoreFormat}`

  const text = await callJudge(prompt)
  return criteria.map(c => parseScore(text, c))
}

// ===== Call 3: Factuality Judge (search-verified, ADVANCED agent) =====

async function judgeFactuality(
  criterion: CriterionDefinition,
  query: string,
  response: string,
): Promise<JudgeScore> {
  const prompt = `You are a factual accuracy evaluator. Use your company search tools to independently verify the claims in this AI agent's response.

=== ${criterion.id.toUpperCase()} ===
${criterion.name}: ${criterion.description}

Rubric:
${criterion.rubric}

=== MATERIAL ===

<query>
${query}
</query>

<agent_response>
${response}
</agent_response>

=== INSTRUCTIONS ===

1. Extract the key factual claims from the response (names, numbers, dates, specifics)
2. Search company data to verify each claim
3. Classify each as VERIFIED / IMPRECISE / UNVERIFIABLE / CONTRADICTED / FABRICATED
4. Score based on the verification profile

<claim_verification>
- "[claim]": [VERIFIED/IMPRECISE/UNVERIFIABLE/CONTRADICTED/FABRICATED] (source: [what you found])
</claim_verification>

<${criterion.id}_reasoning>[Your analysis of factual accuracy]</${criterion.id}_reasoning>
<${criterion.id}>[0-10]</${criterion.id}>`

  // Factuality uses ADVANCED agent with company tools
  const text = await callJudgeWithTools(prompt)
  return parseScore(text, criterion)
}

// ===== LLM call helpers =====

/**
 * Call judge via Glean Chat with Opus 4.6 (no company tools)
 */
async function callJudge(prompt: string): Promise<string> {
  const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.gleanApiKey}`,
    },
    body: JSON.stringify({
      messages: [{ fragments: [{ text: prompt }] }],
      agentConfig: {
        agent: 'DEFAULT',
        modelSetId: 'OPUS_4_6_VERTEX',
      },
      saveChat: false,
      timeoutMillis: 120000,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Judge API error: ${resp.status} - ${err}`)
  }

  return extractContent(await resp.json())
}

/**
 * Call judge via ADVANCED agent with company tools (for factuality verification)
 */
async function callJudgeWithTools(prompt: string): Promise<string> {
  const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.gleanApiKey}`,
    },
    body: JSON.stringify({
      messages: [{ fragments: [{ text: prompt }] }],
      agentConfig: {
        agent: 'ADVANCED',
        modelSetId: 'OPUS_4_6_VERTEX',
        toolSets: { enableCompanyTools: true },
      },
      saveChat: false,
      timeoutMillis: 120000,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Judge (factuality) API error: ${resp.status} - ${err}`)
  }

  return extractContent(await resp.json())
}

/**
 * Extract CONTENT text from Glean chat response
 */
function extractContent(data: any): string {
  let text = ''
  for (const msg of data.messages ?? []) {
    if (msg.author === 'GLEAN_AI' && msg.messageType === 'CONTENT') {
      for (const f of msg.fragments ?? []) {
        if (f.text) text += f.text
      }
    }
  }
  if (!text) throw new Error('No content in judge response')
  return text
}

// ===== Parsing =====

/**
 * Parse score from XML-tagged judge output
 */
function parseScore(text: string, criterion: CriterionDefinition): JudgeScore {
  const id = criterion.id

  // Extract reasoning
  const reasoningRegex = new RegExp(`<${id}_reasoning>([\\s\\S]*?)</${id}_reasoning>`)
  const reasoningMatch = text.match(reasoningRegex)
  const reasoning = reasoningMatch?.[1]?.trim() || 'No reasoning provided'

  // Extract score value
  const scoreRegex = new RegExp(`<${id}>([\\s\\S]*?)</${id}>`)
  const scoreMatch = text.match(scoreRegex)
  const rawScore = scoreMatch?.[1]?.trim()

  if (criterion.scoreType === 'continuous') {
    const numericMatch = rawScore?.match(/(\d+(?:\.\d+)?)/)
    const value = numericMatch ? Math.min(10, Math.max(0, parseFloat(numericMatch[1]))) : 0

    return {
      criterionId: id,
      scoreValue: value,
      reasoning,
      judgeModel: JUDGE_MODEL,
    }
  }

  if (criterion.scoreType === 'binary') {
    const isYes = /yes/i.test(rawScore || '')
    return {
      criterionId: id,
      scoreValue: isYes ? 1 : 0,
      reasoning,
      judgeModel: JUDGE_MODEL,
    }
  }

  if (criterion.scoreType === 'categorical') {
    return {
      criterionId: id,
      scoreCategory: rawScore?.toLowerCase() || 'unknown',
      reasoning,
      judgeModel: JUDGE_MODEL,
    }
  }

  throw new Error(`Cannot parse score type: ${criterion.scoreType}`)
}

// ===== Helpers =====

/**
 * Format reasoning chain for the faithfulness judge
 */
function formatReasoningChain(chain?: any[]): string {
  if (!chain || chain.length === 0) return ''

  return chain.map((step, i) => {
    const parts: string[] = [`Step ${i + 1}:`]

    if (step.action) parts.push(`  Action: ${step.action}`)

    if (step.queries) {
      parts.push(`  Searches:`)
      for (const q of step.queries) {
        parts.push(`    - "${q}"`)
      }
    }

    if (step.documentsRead) {
      parts.push(`  Documents read: ${step.documentsRead.length}`)
      for (const doc of step.documentsRead.slice(0, 5)) {
        parts.push(`    - ${doc.title || doc.url || 'untitled'}`)
      }
      if (step.documentsRead.length > 5) {
        parts.push(`    ... and ${step.documentsRead.length - 5} more`)
      }
    }

    return parts.join('\n')
  }).join('\n\n')
}
