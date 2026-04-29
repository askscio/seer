/**
 * fetchWithRetry — retry transient 5xx / network / timeout failures from Glean.
 *
 * Glean occasionally returns "500 Something went wrong" or ETIMEDOUT on both
 * agent chat calls and judge chat calls. These are almost always transient.
 * We retry with exponential backoff + jitter before bubbling the error up.
 *
 * Semantics:
 * - Retries on: thrown network errors, HTTP 408/429, HTTP 5xx
 * - Does NOT retry on: 4xx (except 408/429) — those are real client errors
 * - On final failure, returns the last Response (caller still does resp.ok check)
 *   or re-throws the last network error.
 */

interface RetryOpts {
  maxAttempts?: number
  baseDelayMs?: number
  label?: string
}

function jitter(delayMs: number): number {
  // ±20% jitter
  const spread = delayMs * 0.2
  return delayMs + (Math.random() * 2 - 1) * spread
}

function shouldRetry(status: number): boolean {
  if (status === 408 || status === 429) return true
  if (status >= 500 && status <= 599) return true
  return false
}

export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  opts: RetryOpts = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 3000
  const label = opts.label ?? 'fetch'

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(input, init)
      if (resp.ok) return resp
      if (attempt < maxAttempts && shouldRetry(resp.status)) {
        const delay = jitter(baseDelayMs * Math.pow(2.5, attempt - 1))
        const bodyPreview = await resp.clone().text().catch(() => '')
        console.warn(
          `[retry] ${label} got ${resp.status} on attempt ${attempt}/${maxAttempts}, sleeping ${Math.round(delay)}ms. Body: ${bodyPreview.slice(0, 180)}`,
        )
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return resp
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const delay = jitter(baseDelayMs * Math.pow(2.5, attempt - 1))
        console.warn(
          `[retry] ${label} threw on attempt ${attempt}/${maxAttempts}: ${(err as Error).message}. Sleeping ${Math.round(delay)}ms.`,
        )
        await new Promise(r => setTimeout(r, delay))
        continue
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed after ${maxAttempts} attempts`)
}
