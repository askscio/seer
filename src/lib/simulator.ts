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
    simulatorStrategy?: string
  },
): Promise<{ reply: string; isComplete: boolean }> {
  const conversationHistory = transcript
    .map(t => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.content}`)
    .join('\n\n')

  const prompt = `You are a simulated user in a conversation with an AI agent. You are NOT the agent — you are the human user.

${evalContext.simulatorContext ? `**Who you are:**\n${evalContext.simulatorContext}` : ''}

**Your original request:** ${evalContext.originalQuery}

${evalContext.simulatorStrategy ? `**How to interact with this agent:**\n${evalContext.simulatorStrategy}` : ''}

**Critical rules:**
- You are the USER. You ANSWER questions, PROVIDE details, and CONFIRM or REDIRECT.
- NEVER ask the agent questions or probe for more information — that is the agent's job, not yours.
- Keep replies concise: 1-3 sentences. Real users don't write essays back to agents.
- If the agent asks you to choose between options, just pick one and say why briefly.
- If the agent delivered a substantive, actionable response to your original request, the conversation is COMPLETE.

**Conversation so far:**
${conversationHistory}

**Agent's latest message:**
${agentMessage}

Decide: Has the agent delivered a substantive response to your request? If yes → COMPLETE. If the agent is asking you something or needs more info → CONTINUE with a brief, natural reply.

Respond in this exact format:
STATUS: COMPLETE or CONTINUE
REPLY: [your concise reply if CONTINUE, or "N/A" if COMPLETE]`

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
