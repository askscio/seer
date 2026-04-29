/**
 * Token-usage ledger for every LLM call (agent runs + judge calls).
 *
 * Glean's REST API does not return token counts (see docs/TRACE_API_LIMITATIONS.md).
 * Token columns are estimates derived from prompt/response character length
 * using the standard chars/4 heuristic. If Glean ever returns a `usage` field
 * with reported counts, callers can pass them in and they'll be recorded
 * alongside the estimates.
 *
 * Usage:
 *   tokenLedger.configure('runs/foo/token-usage.csv')   // once per run
 *   tokenLedger.setContext({ caseId, agentId })          // optional context per case
 *   tokenLedger.record({ scope: 'judge:correctness', model: 'GPT_5', promptText, responseText, latencyMs, status: 'ok' })
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface LedgerInput {
  scope: string                 // 'agent_run', 'agent_run_turn', 'judge:correctness', 'judge:hallucination', etc.
  model: string                 // 'GPT_5', 'OPUS_4_6_VERTEX', 'ADVANCED', 'agent:<id>'
  promptText?: string
  responseText?: string
  latencyMs: number
  status: 'ok' | 'failed'
  error?: string
  // Optional reported counts if the API ever returns them.
  promptTokensReported?: number
  responseTokensReported?: number
  totalTokensReported?: number
  // Override context fields if the global context is wrong for this call.
  caseIdOverride?: string
  agentIdOverride?: string
  runLabelOverride?: string
}

interface LedgerContext {
  caseId?: string
  agentId?: string
  runLabel?: string             // e.g. agent label from orchestrator ("ta_ai_assistant")
}

const HEADER = [
  'timestamp',
  'run_label',
  'scope',
  'model',
  'agent_id',
  'case_id',
  'prompt_chars',
  'response_chars',
  'prompt_tokens_est',
  'response_tokens_est',
  'total_tokens_est',
  'prompt_tokens_reported',
  'response_tokens_reported',
  'total_tokens_reported',
  'latency_ms',
  'status',
  'error',
].join(',') + '\n'

function csvEscape(value: unknown): string {
  if (value == null || value === undefined) return '""'
  const s = String(value)
  return `"${s.replace(/"/g, '""')}"`
}

// Standard rough estimate widely used for LLM cost projection.
// Real token counts vary by tokenizer (cl100k vs o200k vs Anthropic vs Gemini).
function estimateTokens(text?: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

class TokenLedger {
  private path?: string
  private ctx: LedgerContext = {}

  configure(path: string): void {
    this.path = path
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(path)) {
      writeFileSync(path, HEADER, 'utf-8')
    }
  }

  isConfigured(): boolean {
    return !!this.path
  }

  setContext(ctx: LedgerContext): void {
    this.ctx = { ...this.ctx, ...ctx }
  }

  clearContext(): void {
    this.ctx = {}
  }

  record(input: LedgerInput): void {
    if (!this.path) return
    const promptChars = input.promptText?.length || 0
    const responseChars = input.responseText?.length || 0
    const promptTokensEst = estimateTokens(input.promptText)
    const responseTokensEst = estimateTokens(input.responseText)
    const totalTokensEst = promptTokensEst + responseTokensEst

    const row = [
      new Date().toISOString(),
      input.runLabelOverride ?? this.ctx.runLabel ?? '',
      input.scope,
      input.model,
      input.agentIdOverride ?? this.ctx.agentId ?? '',
      input.caseIdOverride ?? this.ctx.caseId ?? '',
      promptChars,
      responseChars,
      promptTokensEst,
      responseTokensEst,
      totalTokensEst,
      input.promptTokensReported ?? '',
      input.responseTokensReported ?? '',
      input.totalTokensReported ?? '',
      input.latencyMs,
      input.status,
      input.error || '',
    ].map(csvEscape).join(',') + '\n'

    appendFileSync(this.path, row, 'utf-8')
  }
}

export const tokenLedger = new TokenLedger()
