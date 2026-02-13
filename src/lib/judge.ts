/**
 * LLM-as-judge implementation supporting all score types:
 * - Continuous (0-10)
 * - Categorical
 * - Binary
 * - Metrics (direct measurement)
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { config } from './config'
import type { CriterionDefinition } from '../criteria/defaults'
import type { JudgeScore, AgentResult } from '../types'
import { extractMetric } from './metrics'

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey })
const openai = new OpenAI({ apiKey: config.openaiApiKey })

/**
 * Judge a response against a criterion
 * Routes to appropriate handler based on score type
 */
export async function judgeResponse(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  agentResult: AgentResult,
  expectedAnswer?: string,
  model: string = 'claude-sonnet-4'
): Promise<JudgeScore> {
  // Metrics don't need judges - direct measurement
  if (criterion.scoreType === 'metric') {
    return extractMetric(criterion, agentResult)
  }

  // Build appropriate prompt for score type
  const prompt = buildJudgePrompt(criterion, query, response, expectedAnswer)

  // Call appropriate model
  const text = model.startsWith('gpt')
    ? await callOpenAI(model, prompt)
    : await callAnthropic(model, prompt)

  // Parse based on score type
  return parseJudgeResponse(text, criterion, model)
}

/**
 * Build judge prompt tailored to score type
 */
function buildJudgePrompt(
  criterion: CriterionDefinition,
  query: string,
  response: string,
  expectedAnswer?: string
): string {
  const basePrompt = `You are evaluating an AI agent's response.

**Criterion:** ${criterion.name}
**Description:** ${criterion.description}

**Rubric:**
${criterion.rubric}

**Original Query:**
${query}

${expectedAnswer ? `**Expected Answer (for reference):**\n${expectedAnswer}\n\n` : ''}**Agent Response:**
${response}

**Instructions:**
1. First, provide your reasoning in 2-3 sentences`

  if (criterion.scoreType === 'continuous') {
    return `${basePrompt}
2. Then, provide a score from 0-10

Format your response exactly as:
REASONING: [your reasoning here]
SCORE: [number 0-10]`
  }

  if (criterion.scoreType === 'categorical') {
    const categories = criterion.scaleConfig?.categories || []
    return `${basePrompt}
2. Then, select the most appropriate category: ${categories.join(', ')}

Format your response exactly as:
REASONING: [your reasoning here]
CATEGORY: [one of: ${categories.join(', ')}]`
  }

  if (criterion.scoreType === 'binary') {
    return `${basePrompt}
2. Then, answer yes or no

Format your response exactly as:
REASONING: [your reasoning here]
ANSWER: [yes or no]`
  }

  throw new Error(`Unknown score type: ${criterion.scoreType}`)
}

/**
 * Parse judge response based on score type
 */
function parseJudgeResponse(
  text: string,
  criterion: CriterionDefinition,
  model: string
): JudgeScore {
  const reasoningMatch = text.match(/REASONING:\s*(.+?)(?=SCORE:|CATEGORY:|ANSWER:|$)/s)

  if (!reasoningMatch) {
    throw new Error('Failed to parse judge reasoning')
  }

  const reasoning = reasoningMatch[1].trim()

  if (criterion.scoreType === 'continuous') {
    const scoreMatch = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i)
    if (!scoreMatch) {
      throw new Error(`Failed to parse continuous score from: ${text}`)
    }

    return {
      criterionId: criterion.id,
      scoreValue: Math.min(10, Math.max(0, parseFloat(scoreMatch[1]))),
      reasoning,
      judgeModel: model
    }
  }

  if (criterion.scoreType === 'categorical') {
    const categoryMatch = text.match(/CATEGORY:\s*(\w+)/i)
    if (!categoryMatch) {
      throw new Error(`Failed to parse category from: ${text}`)
    }

    return {
      criterionId: criterion.id,
      scoreCategory: categoryMatch[1].toLowerCase(),
      reasoning,
      judgeModel: model
    }
  }

  if (criterion.scoreType === 'binary') {
    const answerMatch = text.match(/ANSWER:\s*(yes|no)/i)
    if (!answerMatch) {
      throw new Error(`Failed to parse binary answer from: ${text}`)
    }

    return {
      criterionId: criterion.id,
      scoreValue: answerMatch[1].toLowerCase() === 'yes' ? 1 : 0,
      reasoning,
      judgeModel: model
    }
  }

  throw new Error(`Unknown score type: ${criterion.scoreType}`)
}

/**
 * Call Anthropic API for judging
 */
async function callAnthropic(model: string, prompt: string): Promise<string> {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const message = await anthropic.messages.create({
    model: model === 'claude-sonnet-4' ? 'claude-sonnet-4-20250514' : model,
    max_tokens: 2048,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }]
  })

  const content = message.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic')
  }

  return content.text
}

/**
 * Call OpenAI API for judging
 */
async function callOpenAI(model: string, prompt: string): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 2048
  })

  return completion.choices[0].message.content || ''
}
