/**
 * LLM-as-judge implementation supporting all score types:
 * - Continuous (0-10)
 * - Categorical
 * - Binary
 * - Metrics (direct measurement)
 */

import { config } from './config'
import type { CriterionDefinition } from '../criteria/defaults'
import type { JudgeScore, AgentResult } from '../types'
import { extractMetric } from './metrics'

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

  // Call Glean chat API for judging
  const text = await callGleanChat(prompt)

  // Parse based on score type
  return parseJudgeResponse(text, criterion, 'glean-chat')
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
 * Call Glean Chat API for judging
 */
async function callGleanChat(prompt: string): Promise<string> {
  const response = await fetch(
    `${config.gleanBackend}/rest/api/v1/chat`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.gleanApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Glean Chat API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as any

  // Extract text from Glean chat response
  // Format: { messages: [{ content: "response text" }] } or similar
  const content = data.message?.content || data.messages?.[0]?.content || data.content

  if (!content) {
    console.error('Unexpected Glean chat response:', JSON.stringify(data, null, 2))
    throw new Error('No content found in Glean chat response')
  }

  return content
}
