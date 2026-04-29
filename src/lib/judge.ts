/**
 * LLM-as-judge with four-call architecture and multi-judge ensemble
 *
 * Call 1 (Coverage):     Reference-based — categorical scoring against eval guidance themes
 * Call 2 (Quality):      Standalone — response quality evaluated without eval guidance (no anchoring bias)
 * Call 3 (Faithfulness): Source-grounded — pre-fetched document content injected, verifies claims
 * Call 4 (Factuality):   Search-verified — ADVANCED agent independently verifies + cites sources
 *
 * Each call sees the minimum context it needs — no contamination between dimensions.
 * Multi-judge: runs each call through multiple models, aggregates via majority vote.
 * Categorical scales per I/O psych SJT research (15% reliability gain).
 */

import { config } from './config'
import { extractContentTextOrThrow, type GleanResponse } from './extract-content'
import type { CriterionDefinition } from '../criteria/defaults'
import type { JudgeScore, AgentResult, ConversationTurn } from '../types'
import { extractMetric } from './metrics'
import { fetchSourceDocContent, type SourceDoc } from './fetch-docs'
import { fetchWithRetry } from './retry'
import { tokenLedger } from './token-ledger'

/**
 * Format an agent's output for judging.
 * For multi-turn conversations, renders the full transcript.
 * For single-turn, returns the response as-is.
 */
function formatResponseForJudge(response: string, transcript?: ConversationTurn[]): string {
  if (!transcript || transcript.length <= 2) return response

  // Multi-turn: format as a readable conversation
  const formatted = transcript
    .map(t => `**${t.role === 'user' ? 'User' : 'Agent'}:** ${t.content}`)
    .join('\n\n')

  return `[Multi-turn conversation — ${transcript.filter(t => t.role === 'agent').length} agent turns]\n\n${formatted}`
}

// Available judge models (cross-family panel)
// Single source of truth — UI imports this via web/lib/dimensions.ts
export const JUDGE_MODELS: { id: string; name: string; displayName: string; provider: string }[] = [
  { id: 'OPUS_4_6_VERTEX', name: 'opus-4-6', displayName: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'GPT_5', name: 'gpt-5', displayName: 'GPT-5', provider: 'OpenAI' },
  { id: 'ADVANCED', name: 'gemini-advanced', displayName: 'Gemini (Advanced)', provider: 'Google' },
]

const DEFAULT_MODEL = JUDGE_MODELS[0]

/** Resolve model IDs to model objects, falling back to default */
function resolveModels(modelIds?: string[]): typeof JUDGE_MODELS {
  if (!modelIds || modelIds.length === 0) return [DEFAULT_MODEL]
  const resolved = modelIds
    .map(id => JUDGE_MODELS.find(m => m.id === id))
    .filter((m): m is typeof JUDGE_MODELS[number] => m !== undefined)
  return resolved.length > 0 ? resolved : [DEFAULT_MODEL]
}

/**
 * Batch judge with optional multi-judge ensemble.
 * Pass modelIds to control which models score. 1 model = single judge, 2+ = ensemble.
 */
export async function judgeResponseBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  agentResult: AgentResult,
  evalGuidance?: string,
  modelIds?: string[],
): Promise<JudgeScore[]> {
  const models = resolveModels(modelIds)

  if (models.length === 1) {
    // Single judge (default — faster)
    return runJudgePipeline(criteria, query, response, agentResult, evalGuidance, models[0])
  }

  // Multi-judge: run through selected models, aggregate
  console.log(`  → Multi-judge: ${models.map(m => m.name).join(', ')}`)
  const allResults = await Promise.all(
    models.map(model =>
      runJudgePipeline(criteria, query, response, agentResult, evalGuidance, model)
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

  // Aggregate: majority vote per criterion
  return aggregateScores(criteria, successfulResults)
}

// Keep single-criterion interface for backward compatibility
export async function judgeResponse(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  agentResult: AgentResult,
  evalGuidance?: string,
  modelIds?: string[],
): Promise<JudgeScore> {
  const scores = await judgeResponseBatch([criterion], query, response, agentResult, evalGuidance, modelIds)
  return scores[0]
}

/**
 * Run the full judge pipeline for one model.
 *
 * Four judge calls, each with minimum viable context:
 * 1. Coverage — query + eval guidance + response (SKIPPED if no eval guidance)
 * 2. Quality — query + response only (isolated from eval guidance to prevent anchoring)
 * 3. Faithfulness — query + response + pre-fetched doc content + reasoning chain
 * 4. Factuality — query + response + live search (ADVANCED agent)
 */
async function runJudgePipeline(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  agentResult: AgentResult,
  evalGuidance: string | undefined,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const scores: JudgeScore[] = []

  // For multi-turn conversations, format the full transcript for judges
  const judgeResponse = formatResponseForJudge(response, agentResult.transcript)

  const coverageCriteria = criteria.filter(c => c.judgeCall === 'coverage')
  const qualityCriteria = criteria.filter(c => c.judgeCall === 'quality')
  const faithfulnessCriteria = criteria.filter(c => c.judgeCall === 'faithfulness')
  const factualityCriteria = criteria.filter(c => c.judgeCall === 'factuality')
  const metricCriteria = criteria.filter(c => c.judgeCall === 'metric')
  const customCriteria = criteria.filter(c => c.judgeCall === 'custom')

  // Metrics: direct extraction, no API call
  for (const c of metricCriteria) {
    scores.push(extractMetric(c, agentResult))
  }

  // Fetch source doc content (needed for faithfulness call)
  let sourceDocContent: SourceDoc[] = []
  if (faithfulnessCriteria.length > 0) {
    sourceDocContent = await fetchSourceDocContent(agentResult.reasoningChain)
  }

  // Call 1: Coverage — skip if no eval guidance (themes are undefined without it)
  if (coverageCriteria.length > 0) {
    if (evalGuidance) {
      scores.push(...await judgeCoverageBatch(coverageCriteria, query, judgeResponse, evalGuidance, model))
    } else {
      // No eval guidance → skip coverage dimensions with explicit 'skipped' status
      for (const c of coverageCriteria) {
        scores.push({
          criterionId: c.id,
          scoreCategory: 'skipped',
          reasoning: 'No eval guidance provided — topical coverage requires themes to evaluate against.',
          judgeModel: model.name,
        })
      }
    }
  }

  // Call 2: Quality — query + response only (no eval guidance, no anchoring bias)
  if (qualityCriteria.length > 0) {
    scores.push(...await judgeQualityBatch(qualityCriteria, query, judgeResponse, model))
  }

  // Call 3: Faithfulness — pre-fetched doc content injected (DEFAULT agent, full model control)
  if (faithfulnessCriteria.length > 0) {
    scores.push(...await judgeFaithfulnessBatch(faithfulnessCriteria, query, judgeResponse, agentResult.reasoningChain, sourceDocContent, model))
  }

  // Call 4: Factuality — ADVANCED agent with live search
  for (const c of factualityCriteria) {
    scores.push(await judgeFactuality(c, query, judgeResponse, agentResult, model))
  }

  // Custom dimensions — each gets its own quality-style call with the user's rubric
  if (customCriteria.length > 0) {
    scores.push(...await judgeCustomBatch(customCriteria, query, judgeResponse, model))
  }

  return scores
}

// ===== Call 1: Coverage (reference-based, categorical) =====
// Only called when evalGuidance is present (guarded in runJudgePipeline)

async function judgeCoverageBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  evalGuidance: string,
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

<eval_guidance>
${evalGuidance}
</eval_guidance>

<actual_response>
${response}
</actual_response>

=== INSTRUCTIONS ===

1. Extract the key themes from the eval guidance
2. For each theme, classify coverage: COVERED / TOUCHED / MISSING
3. Assign a category for each dimension using the rubric

The eval guidance describes ONE valid answer, not THE only valid answer. Do not penalize different wording or additional correct information. Evaluate information density, not length.

<theme_coverage>
- [theme]: [COVERED/TOUCHED/MISSING]
</theme_coverage>

${scoreFormat}`

  const text = await callJudge(prompt, model.id)
  return criteria.map(c => parseScore(text, c, model.name))
}

// ===== Call 2: Quality (standalone, isolated from coverage) =====
// Evaluates response quality without eval guidance to prevent anchoring bias

async function judgeQualityBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const criteriaBlock = criteria.map(c =>
    `=== ${c.id.toUpperCase()} ===\n${c.name}: ${c.description}\n\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c =>
    `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[${c.scaleConfig?.categories?.join(' / ') || 'value'}]</${c.id}>`
  ).join('\n\n')

  const prompt = `You are an expert evaluator assessing the quality of an AI agent's response. You are evaluating ONLY the structure, clarity, and presentation — not factual correctness or topic coverage.

${criteriaBlock}

=== MATERIAL ===

<query>
${query}
</query>

<actual_response>
${response}
</actual_response>

=== INSTRUCTIONS ===

1. Evaluate the response's structure, conciseness, and actionability
2. Check formatting appropriateness for the query type
3. Assess information density — concise and specific is better than verbose and padded
4. Assign a category using the rubric

Do NOT evaluate whether the response covers the right topics or contains correct facts. Focus purely on how well the information is presented.

${scoreFormat}`

  const text = await callJudge(prompt, model.id)
  return criteria.map(c => parseScore(text, c, model.name))
}

// ===== Call 3: Faithfulness (source-grounded, pre-fetched content) =====
// Uses DEFAULT agent with modelSetId — document content is injected, no search tools needed.
//
// Methodology adapted from internal Hallucination Judge and Groundedness Judge:
// - Hallucination Judge -> labels each claim Faithful/Hallucinated/Ungrounded -> maps to low/medium/high.
// - Groundedness Judge -> labels each claim Inferable/Generic/Ungrounded -> maps to full/.../failure.
// Each criterion routed by id; unknown faithfulness criteria fall back to a generic claim-check.

async function judgeFaithfulnessBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  reasoningChain: any[] | undefined,
  sourceDocContent: SourceDoc[],
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const contextText = formatContextForFaithfulness(sourceDocContent, reasoningChain)
  const out: JudgeScore[] = []
  for (const c of criteria) {
    if (c.id === 'hallucination_risk') {
      out.push(await callHallucinationJudge(c, query, response, contextText, model))
    } else if (c.id === 'groundedness') {
      out.push(await callGroundednessJudge(c, query, response, contextText, model))
    } else {
      out.push(await callGroundednessJudge(c, query, response, contextText, model))
    }
  }
  return out
}

function formatContextForFaithfulness(sourceDocContent: SourceDoc[], reasoningChain?: any[]): string {
  const chainText = formatReasoningChain(reasoningChain)
  const docContentBlock = sourceDocContent.length > 0
    ? sourceDocContent.map(doc => `--- ${doc.title} ---\n${doc.content}`).join('\n\n')
    : 'No documents were retrieved by the agent.'

  return `Agent execution trace:\n${chainText || '(none)'}\n\nAgent retrieved source documents:\n${docContentBlock}`
}

interface StatementVerdict {
  statement: string
  reasoning: string
  verdict: string
}

async function callHallucinationJudge(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  context: string,
  model: { id: string; name: string },
): Promise<JudgeScore> {
  const prompt = `You will be provided with a current objective, a response, the context used to generate the response, and an optional conversation history. The current objective or the response may refer to conversation history.

Your task is to evaluate the faithfulness of the response to the given information in the context and conversation history. Follow these steps:
1. Identify Key Statements: Extract the main statements or claims from the response. Focus only on the important claims and ignore any general disclaimers.
2. Label the Statements: Assess each statement using the following labels:
- Faithful: The statement can be logically deduced from the context or conversation history, is directly supported by them, or transparently states its assumptions.
- Hallucinated: The statement misrepresents the context or conversation history by making unsupported assumptions, contradictions, or fabrications based on that information.
- Ungrounded: The statement does not reference information from either the context or conversation history.

For each statement, create a structured entry with the following components:
- statement: The specific statement or claim.
- reasoning: Verbalize your reasoning as you think about the label
- verdict: The label you assigned, it must be one of {Faithful,Hallucinated,Ungrounded}.

Prepare your final output in valid JSON format as a list of structured entries, each representing an evaluation of a statement.

Ensure that your final output strictly complies with the valid JSON format.

Here is the entry for you to evaluate:

INPUT:

"current_objective": ${JSON.stringify(query)}
"context": ${JSON.stringify(context)}
"response": ${JSON.stringify(response)}
"conversation_history": ""

OUTPUT:`

  const text = await callJudge(prompt, model.id, 'judge:hallucination')
  const verdicts = parseStatementVerdicts(text)

  const lower = (s: string) => s.toLowerCase()
  const hasHallucinated = verdicts.some(v => lower(v.verdict).includes('hallucinated'))
  const hasUngrounded = verdicts.some(v => lower(v.verdict).includes('ungrounded'))
  let category: string
  if (hasHallucinated) category = 'high'
  else if (hasUngrounded) category = 'medium'
  else category = 'low'

  const reasoning = verdicts.length > 0
    ? verdicts.map(v => `- "${truncate(v.statement, 200)}" -> ${v.verdict}: ${truncate(v.reasoning, 240)}`).join('\n')
    : 'No statements extracted; defaulting to low risk.'

  return {
    criterionId: criterion.id,
    scoreCategory: category,
    reasoning,
    judgeModel: model.name,
  }
}

async function callGroundednessJudge(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  context: string,
  model: { id: string; name: string },
): Promise<JudgeScore> {
  const prompt = `You are an expert model evaluator tasked with assessing the groundedness of a model's response in relation to the provided context.

You will be given:
- A **query**
- A **context** containing information relevant to the query
- A **response** generated by the model

Your task is to evaluate the groundedness of the response by following these steps:
1. Identify Key Statements: Extract the main statements or claims made in the response. Only focus on the important claims, and ignore any general disclaimers or vague statements.
2. Label the Statements: For each extracted statement, assign one of the following groundedness labels based on how it relates to the provided context:
- Inferable: The statement can be **logically deduced** from, or is **directly supported by** the context.
- Generic: The statement is a **general disclaimer** or **conversation filler** that does not require context-based support.
- Ungrounded: The statement is **not supported by** the context or **contradicts** the provided information.

For each statement, create a structured entry with the following components:
- statement: The specific statement or claim.
- reasoning: Verbalize your reasoning as you think about the groundedness label
- verdict: The groundedness label you assigned, it must be one of {Inferable, Generic, Ungrounded}.

You MUST output a valid JSON with a list of structured entries, each representing an evaluation of a statement.

Here is the entry for you to evaluate:

<query>
${query}
</query>

<context>
${context}
</context>

<response>
${response}
</response>

Json Output:`

  const text = await callJudge(prompt, model.id, 'judge:groundedness')
  const verdicts = parseStatementVerdicts(text)

  const judgeable = verdicts.filter(v => !/generic/i.test(v.verdict))
  const inferable = judgeable.filter(v => /inferable/i.test(v.verdict)).length
  const total = judgeable.length

  let category: string
  if (total === 0) {
    category = 'substantial'
  } else {
    const ratio = inferable / total
    if (ratio >= 0.95) category = 'full'
    else if (ratio >= 0.75) category = 'substantial'
    else if (ratio >= 0.5) category = 'partial'
    else if (ratio > 0) category = 'minimal'
    else category = 'failure'
  }

  const reasoning = verdicts.length > 0
    ? verdicts.map(v => `- "${truncate(v.statement, 200)}" -> ${v.verdict}: ${truncate(v.reasoning, 240)}`).join('\n')
    : 'No statements extracted; defaulting to substantial.'

  return {
    criterionId: criterion.id,
    scoreCategory: category,
    reasoning,
    judgeModel: model.name,
  }
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}...` : s
}

// ===== Call 4: Factuality (search-verified, source-citing) =====

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
    || []

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

// ===== Custom Dimensions (user-defined rubric, quality-style call) =====

async function judgeCustomBatch(
  criteria: CriterionDefinition[],
  query: string,
  response: string,
  model: { id: string; name: string },
): Promise<JudgeScore[]> {
  const criteriaBlock = criteria.map(c =>
    `=== ${c.name.toUpperCase()} ===\n${c.description}\n\n${c.rubric}`
  ).join('\n\n')

  const scoreFormat = criteria.map(c => {
    const categories = c.scaleConfig?.categories?.join(' / ') || 'value'
    return `<${c.id}_reasoning>[Your analysis]</${c.id}_reasoning>\n<${c.id}>[${categories}]</${c.id}>`
  }).join('\n\n')

  const prompt = `You are an expert evaluator assessing an AI agent's response using custom evaluation criteria.

${criteriaBlock}

=== MATERIAL ===

<query>
${query}
</query>

<actual_response>
${response}
</actual_response>

=== INSTRUCTIONS ===

Evaluate the response against each criterion using the rubric provided. Be specific and cite examples from the response.

${scoreFormat}`

  const text = await callJudge(prompt, model.id)
  return criteria.map(c => parseScore(text, c, model.name))
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

    // Skip aggregation for skipped dimensions
    if (scoresForCriterion.every(s => s.scoreCategory === 'skipped')) {
      return scoresForCriterion[0]
    }

    // For categorical: take majority vote
    if (criterion.scoreType === 'categorical' && scoresForCriterion[0].scoreCategory) {
      const categories = scoresForCriterion.map(s => s.scoreCategory!).filter(c => c && c !== 'skipped')
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

async function callJudge(prompt: string, modelSetId: string, scope = 'judge'): Promise<string> {
  const start = Date.now()
  const resp = await fetchWithRetry(
    `${config.gleanBackend}/rest/api/v1/chat`,
    {
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
      signal: AbortSignal.timeout(130_000),
    },
    { label: `judge:${modelSetId}:${scope}` },
  )

  if (!resp.ok) {
    const err = await resp.text()
    tokenLedger.record({
      scope,
      model: modelSetId,
      promptText: prompt,
      responseText: err,
      latencyMs: Date.now() - start,
      status: 'failed',
      error: `${resp.status} ${resp.statusText}`,
    })
    throw new Error(`Judge (${modelSetId}) error: ${resp.status} - ${err}`)
  }

  const text = extractContent(await resp.json() as GleanResponse)
  tokenLedger.record({
    scope,
    model: modelSetId,
    promptText: prompt,
    responseText: text,
    latencyMs: Date.now() - start,
    status: 'ok',
  })
  return text
}

async function callJudgeWithTools(prompt: string, modelSetId: string, scope = 'judge:factuality'): Promise<string> {
  const start = Date.now()
  const resp = await fetchWithRetry(
    `${config.gleanBackend}/rest/api/v1/chat`,
    {
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
      signal: AbortSignal.timeout(130_000),
    },
    { label: `judge-tools:${modelSetId}:${scope}` },
  )

  if (!resp.ok) {
    const err = await resp.text()
    tokenLedger.record({
      scope,
      model: modelSetId,
      promptText: prompt,
      responseText: err,
      latencyMs: Date.now() - start,
      status: 'failed',
      error: `${resp.status} ${resp.statusText}`,
    })
    throw new Error(`Judge factuality (${modelSetId}) error: ${resp.status} - ${err}`)
  }

  const text = extractContent(await resp.json() as GleanResponse)
  tokenLedger.record({
    scope,
    model: modelSetId,
    promptText: prompt,
    responseText: text,
    latencyMs: Date.now() - start,
    status: 'ok',
  })
  return text
}

// Content extraction delegated to shared extract-content.ts
const extractContent = extractContentTextOrThrow

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

function parseStatementVerdicts(text: string): StatementVerdict[] {
  if (!text) return []
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenceMatch?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return normalizeVerdicts(parsed)
    } catch {}
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1))
        if (Array.isArray(parsed)) return normalizeVerdicts(parsed)
      } catch {}
    }
  }
  return []
}

function normalizeVerdicts(items: any[]): StatementVerdict[] {
  return items
    .filter(it => it && typeof it === 'object')
    .map(it => ({
      statement: String(it.statement || '').trim(),
      reasoning: String(it.reasoning || '').trim(),
      verdict: String(it.verdict || '').trim(),
    }))
    .filter(v => v.statement || v.verdict)
}

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
