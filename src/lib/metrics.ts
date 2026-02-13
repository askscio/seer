/**
 * Metric extraction from agent results
 * For criteria with scoreType='metric'
 */

import type { AgentResult, JudgeScore } from '../types'
import type { CriterionDefinition } from '../criteria/defaults'

/**
 * Extract metric value directly from agent result
 * No LLM judge needed - direct measurement
 */
export function extractMetric(
  criterion: CriterionDefinition,
  agentResult: AgentResult
): JudgeScore {
  const extractor = criterion.scaleConfig?.metricExtractor

  let value: number

  switch (extractor) {
    case 'latencyMs':
      value = agentResult.latencyMs
      break

    case 'totalTokens':
      value = agentResult.totalTokens || 0
      break

    case 'toolCallCount':
      value = agentResult.toolCalls?.length || 0
      break

    default:
      throw new Error(`Unknown metric extractor: ${extractor}`)
  }

  return {
    criterionId: criterion.id,
    scoreValue: value,
    reasoning: `Measured directly: ${value}`,
    judgeModel: 'direct-measurement'
  }
}
