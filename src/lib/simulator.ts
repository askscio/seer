/**
 * Conversation Simulator — LLM-based simulated user for multi-turn agent evaluation.
 *
 * Inspired by Anthropic's Petri auditor pattern but simpler:
 * - Receives eval case context (user goal, domain context, eval guidance)
 * - Reads the agent's latest message and crafts a realistic user reply
 * - Knows when to stop (agent produced a final answer, or max turns reached)
 *
 * Uses the ADVANCED agent for simulation — it has company context to craft
 * realistic, grounded replies (e.g., real account names, actual metrics).
 */

import { config } from './config'
import { extractContentWithFallback, type GleanResponse } from './extract-content'
import type { ConversationTurn } from '../types'

export interface SimulatorConfig {
  maxTurns: number          // Max conversation turns (default: 5)
  timeoutMs: number         // Total timeout for the conversation (default: 300s)
  simulatorContext?: string // Instructions for how the simulated user should behave
}

export interface SimulatorResult {
  transcript: ConversationTurn[]
  finalResponse: string     // Agent's last CONTENT message
  turnCount: number
  stoppedReason: 'complete' | 'max_turns' | 'timeout' | 'error'
}

const DEFAULT_CONFIG: SimulatorConfig = {
  maxTurns: 5,
  timeoutMs: 300_000,
}

/**
 * Generate a simulated user reply given the conversation so far.
 *
 * The simulator acts as a realistic user based on the eval case context.
 * It decides what to say next, or signals that the conversation is complete.
 */
export async function generateUserReply(
  agentMessage: string,
  transcript: ConversationTurn[],
  evalContext: {
    originalQuery: string
    evalGuidance?: string
    simulatorContext?: string
  },
): Promise<{ reply: string; isComplete: boolean }> {
  const conversationHistory = transcript
    .map(t => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.content}`)
    .join('\n\n')

  const prompt = `You are simulating a realistic user in a conversation with a Glean AI agent.

${evalContext.simulatorContext ? `**Your role:** ${evalContext.simulatorContext}` : ''}

**Original user goal:** ${evalContext.originalQuery}

${evalContext.evalGuidance ? `**What a good outcome looks like:** ${evalContext.evalGuidance}` : ''}

**Conversation so far:**
${conversationHistory}

**Agent's latest message:**
${agentMessage}

Based on this conversation, decide:
1. Has the agent provided a substantive, complete response to the user's goal? If yes, the conversation is COMPLETE.
2. If not, what would the user realistically say next? Consider:
   - Answer any questions the agent asked
   - Provide requested clarifications using realistic, specific details
   - Keep responses concise and natural (1-3 sentences typically)
   - Stay in character based on the original goal

Respond in this exact format:
STATUS: COMPLETE or CONTINUE
REPLY: [your reply if CONTINUE, or "N/A" if COMPLETE]`

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
        toolSets: { enableCompanyTools: true },
      },
      saveChat: false,
      timeoutMillis: 30000,
    }),
  })

  if (!resp.ok) {
    throw new Error(`Simulator error: ${resp.status} - ${await resp.text()}`)
  }

  const data = await resp.json() as GleanResponse
  const text = extractContentWithFallback(data)

  // Parse the response
  const statusMatch = text.match(/STATUS:\s*(COMPLETE|CONTINUE)/i)
  const replyMatch = text.match(/REPLY:\s*([\s\S]*?)$/i)

  const isComplete = statusMatch?.[1]?.toUpperCase() === 'COMPLETE'
  const reply = replyMatch?.[1]?.trim() || ''

  return { reply: isComplete ? '' : reply, isComplete }
}
