/**
 * LLM-as-judge with three-call architecture and multi-judge ensemble
 *
 * Call 1 (Coverage):     Reference-based — categorical scoring against expected answer
 * Call 2 (Faithfulness): Reference-free — categorical scoring against agent's own retrieval
 * Call 3 (Factuality):   Search-verified — ADVANCED agent verifies + cites sources
 *
 * Multi-judge: runs each call through multiple models, aggregates via median.
 * Categorical scales per I/O psych SJT research (15% reliability gain).
 */

import { config } from './config'
import type { CriterionDefinition } from '../criteria/defaults'
import type { JudgeScore, AgentResult } from '../types'
import { extractMetric } from './metrics'

// Available judge models (cross-family panel)
const JUDGE_MODELS: { id: string; name: string }[] = [
  { id: 'OPUS_4_6_VERTEX', name: 'opus-4-6' },
  { id: 'GPT_5', name: 'gpt-5' },
]

/**
 * Batch judge with optional multi-judge ensemble
 */
export async function judgeResponseBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer?: string,
  multiJudge: boolean = false,
): Promise<JudgeScore[]> {
  if (!multiJudge) {
    // Single judge (default — faster)
    return runJudgePipeline(criteria, query, response, agentResult, expectedAnswer, JUDGE_MODELS[0])
  }

  // Multi-judge: run through all models, aggregate
  console.log(`  → Multi-judge: ${JUDGE_MODELS.map(m => m.name).join(', ')}`)
  const allResults = await Promise.all(
    JUDGE_MODELS.map(model =>
      runJudgePipeline(criteria, query, response, agentResult, expectedAnswer, model)
        .catch(err => {
          console.warn(`  ⚠ ${model.name} failed: ${err.message}`)
          return null
        })
    )
  )

  // Filter out failed judges
  const successfulResults = allResults.filter((r): r is JudgeScore[] => r !== null)

  if (successfulResults.length === 0) {
    throw new Error('All judge models failed')
  }

  if (successfulResults.length === 1) {
    return successfulResults[0]
  }

  // Aggregate: for each criterion, take median score across judges
  return aggregateScores(criteria, successfulResults)
}

// Keep single-criterion interface for backward compatibility
export async function judgeResponse(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer?: string,
): Promise<JudgeScore> {
  const scores = await judgeResponseBatch([criterion], query, response, agentResult, expectedAnswer)
  return scores[0]
}

/**
 * Run the full judge pipeline for one model
 */
async function runJudgePipeline(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer: string | undefined,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const scores: JudgeScore[] = []

  const coverageCriteria = criteria.filter(c => c.judgeCall === 'coverage')
  const faithfulnessCriteria = criteria.filter(c => c.judgeCall === 'faithfulness')
  const factualityCriteria = criteria.filter(c => c.judgeCall === 'factuality')
  const metricCriteria = criteria.filter(c => c.judgeCall === 'metric')

  for (const c of metricCriteria) {
    scores.push(extractMetric(c, agentResult))
  }

  if (coverageCriteria.length > 0) {
    scores.push(...await judgeCoverageBatch(coverageCriteria, query, response, expectedAnswer, model))
  }

  if (faithfulnessCriteria.length > 0) {
    scores.push(...await judgeFaithfulnessBatch(faithfulnessCriteria, query, response, agentResult.reasoningChain, model))
  }

  for (const c of factualityCriteria) {
    scores.push(await judgeFactuality(c, query, response, agentResult, model))
  }

  return scores
}

// ===== Call 1: Coverage (reference-based, categorical) =====

async function judgeCoverageBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  expectedAnswer: string | undefined,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const criteriaBlock = criteria.map(c =>
    `=== ${c.id.toUpperCase()} ===\n${c.name}: ${c.description}\n\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c =>
    `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[${c.scaleConfig?.categories?.join(' / ') || 'value'}]</${c.id}>`
  ).join('\n\n')

  const prompt = `You are an expert evaluator assessing an AI agent's response.

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
2. For each theme, classify coverage: COVERED / TOUCHED / MISSING
3. Assign a category for each dimension using the rubric
` : `1. Evaluate the response directly against the query
2. Assign a category for each dimension using the rubric
`}
The expected answer is ONE valid answer, not THE only valid answer. Do not penalize different wording or additional correct information. Evaluate information density, not length.

<theme_coverage>
- [theme]: [COVERED/TOUCHED/MISSING]
</theme_coverage>

${scoreFormat}`

  const text = await callJudge(prompt, model.id)
  return criteria.map(c => parseScore(text, c, model.name))
}

// ===== Call 2: Faithfulness (reference-free, categorical) =====

async function judgeFaithfulnessBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  reasoningChain: any[] | undefined,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const chainText = formatReasoningChain(reasoningChain)

  const criteriaBlock = criteria.map(c =>
    `=== ${c.id.toUpperCase()} ===\n${c.name}: ${c.description}\n\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c => {
    if (c.scoreType === 'binary') {
      return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[yes or no]</${c.id}>`
    }
    return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[${c.scaleConfig?.categories?.join(' / ') || 'value'}]</${c.id}>`
  }).join('\n\n')

  const prompt = `You are evaluating whether an AI agent's response is faithful to what it actually retrieved. You are NOT checking correctness — only whether it accurately represents what was found.

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

1. Identify key claims in the response
2. Check each against the documents in the reasoning chain
3. Assign categories using the rubrics

A response that says "no data found" when no documents were retrieved is CORRECT behavior.

<claim_check>
- "[claim]": [GROUNDED/UNGROUNDED/HEDGED]
</claim_check>

${scoreFormat}`

  const text = await callJudge(prompt, model.id)
  return criteria.map(c => parseScore(text, c, model.name))
}

// ===== Call 3: Factuality (search-verified, source-citing) =====

async function judgeFactuality(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  agentResult: AgentResult,
  model: { id: string; name: string },
): Promise<JudgeScore> {
  // Include the agent's own sources so the judge can check them specifically
  const agentSources = agentResult.reasoningChain
    ?.filter(s => s.documentsRead)
    .flatMap(s => s.documentsRead)
    .map((d: any) => d.title || d.url)
    .filter(Boolean)
    .slice(0, 20) || []

  const sourcesBlock = agentSources.length > 0
    ? `\n<agent_sources>\nThe agent retrieved these documents during execution:\n${agentSources.map((s: string) => `- ${s}`).join('\n')}\n</agent_sources>\n`
    : ''

  const prompt = `You are a factual accuracy evaluator. Use your company search tools to independently verify the claims in this AI agent's response. Cite your sources for each verification.

=== ${criterion.id.toUpperCase()} ===
${criterion.name}: ${criterion.description}

${criterion.rubric}

=== MATERIAL ===

<query>
${query}
</query>
${sourcesBlock}
<agent_response>
${response}
</agent_response>

=== INSTRUCTIONS ===

1. Extract key factual claims (names, numbers, dates, specifics)
2. Search company data to verify each — also check the agent's own retrieved sources if listed above
3. Classify each claim AND cite your source document/system
4. Assign a category

<claim_verification>
- "[claim]": [VERIFIED/IMPRECISE/UNVERIFIABLE/CONTRADICTED/FABRICATED] (source: [what you found and where])
</claim_verification>

<${criterion.id}_reasoning>[Analysis of factual accuracy with source citations]</${criterion.id}_reasoning>
<${criterion.id}>[${criterion.scaleConfig?.categories?.join(' / ')}]</${criterion.id}>`

  const text = await callJudgeWithTools(prompt, model.id)
  return parseScore(text, criterion, model.name)
}

// ===== Multi-judge aggregation =====

function aggregateScores(
  criteria: CriterionDefinition[],
  allResults: JudgeScore[][],
): JudgeScore[] {
  return criteria.map((criterion) => {
    const scoresForCriterion = allResults
      .map(results => results.find(s => s.criterionId === criterion.id))
      .filter((s): s is JudgeScore => s !== undefined)

    if (scoresForCriterion.length === 0) {
      return { criterionId: criterion.id, reasoning: 'No judge produced a score', judgeModel: 'ensemble' }
    }

    if (scoresForCriterion.length === 1) {
      return scoresForCriterion[0]
    }

    // For categorical: take majority vote
    if (criterion.scoreType === 'categorical' && scoresForCriterion[0].scoreCategory) {
      const categories = scoresForCriterion.map(s => s.scoreCategory!).filter(Boolean)
      const counts = new Map<string, number>()
      for (const cat of categories) {
        counts.set(cat, (counts.get(cat) || 0) + 1)
      }
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]

      const allReasoning = scoresForCriterion
        .map(s => `[${s.judgeModel}]: ${s.reasoning}`)
        .join('\n\n')

      const agreement = counts.get(majority)! / categories.length

      return {
        criterionId: criterion.id,
        scoreCategory: majority,
        reasoning: `Ensemble (${agreement === 1 ? 'unanimous' : `${Math.round(agreement * 100)}% agreement`}):\n\n${allReasoning}`,
        judgeModel: `ensemble(${scoresForCriterion.map(s => s.judgeModel).join('+')})`,
      }
    }

    // For binary: majority vote
    if (criterion.scoreType === 'binary') {
      const values = scoresForCriterion.map(s => s.scoreValue!).filter(v => v !== undefined)
      const yesCount = values.filter(v => v === 1).length
      const majority = yesCount > values.length / 2 ? 1 : 0

      const allReasoning = scoresForCriterion
        .map(s => `[${s.judgeModel}]: ${s.reasoning}`)
        .join('\n\n')

      return {
        criterionId: criterion.id,
        scoreValue: majority,
        reasoning: `Ensemble (${yesCount}/${values.length} yes):\n\n${allReasoning}`,
        judgeModel: `ensemble(${scoresForCriterion.map(s => s.judgeModel).join('+')})`,
      }
    }

    // Fallback
    return scoresForCriterion[0]
  })
}

// ===== LLM call helpers =====

async function callJudge(prompt: string, modelSetId: string): Promise<string> {
  const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.gleanApiKey}`,
    },
    body: JSON.stringify({
      messages: [{ fragments: [{ text: prompt }] }],
      agentConfig: { agent: 'DEFAULT', modelSetId },
      saveChat: false,
      timeoutMillis: 120000,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Judge (${modelSetId}) error: ${resp.status} - ${err}`)
  }

  return extractContent(await resp.json())
}

async function callJudgeWithTools(prompt: string, modelSetId: string): Promise<string> {
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
        modelSetId,
        toolSets: { enableCompanyTools: true },
      },
      saveChat: false,
      timeoutMillis: 120000,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Judge factuality (${modelSetId}) error: ${resp.status} - ${err}`)
  }

  return extractContent(await resp.json())
}

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

function parseScore(text: string, criterion: CriterionDefinition, modelName: string): JudgeScore {
  const id = criterion.id

  const reasoningRegex = new RegExp(`<${id}_reasoning>([\\s\\S]*?)</${id}_reasoning>`)
  const reasoningMatch = text.match(reasoningRegex)
  const reasoning = reasoningMatch?.[1]?.trim() || 'No reasoning provided'

  const scoreRegex = new RegExp(`<${id}>([\\s\\S]*?)</${id}>`)
  const scoreMatch = text.match(scoreRegex)
  const rawScore = scoreMatch?.[1]?.trim()?.toLowerCase()

  if (criterion.scoreType === 'categorical') {
    const categories = criterion.scaleConfig?.categories || []
    const matched = categories.find(cat => rawScore?.includes(cat))

    return {
      criterionId: id,
      scoreCategory: matched || rawScore || 'unknown',
      reasoning,
      judgeModel: modelName,
    }
  }

  if (criterion.scoreType === 'binary') {
    return {
      criterionId: id,
      scoreValue: /yes/i.test(rawScore || '') ? 1 : 0,
      reasoning,
      judgeModel: modelName,
    }
  }

  throw new Error(`Cannot parse score type: ${criterion.scoreType}`)
}

// ===== Helpers =====

function formatReasoningChain(chain?: any[]): string {
  if (!chain || chain.length === 0) return ''

  return chain.map((step, i) => {
    const parts: string[] = [`Step ${i + 1}:`]
    if (step.action) parts.push(`  Action: ${step.action}`)
    if (step.queries) {
      parts.push(`  Searches:`)
      for (const q of step.queries) parts.push(`    - "${q}"`)
    }
    if (step.documentsRead) {
      parts.push(`  Documents read: ${step.documentsRead.length}`)
      for (const doc of step.documentsRead.slice(0, 5)) {
        parts.push(`    - ${doc.title || doc.url || 'untitled'}`)
      }
      if (step.documentsRead.length > 5) parts.push(`    ... +${step.documentsRead.length - 5} more`)
    }
    return parts.join('\n')
  }).join('\n\n')
}
