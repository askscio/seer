/**
 * Source document content retrieval for faithfulness judging
 *
 * Two strategies:
 * 1. Primary: Use ADVANCED Chat API to summarize source docs in a single call.
 *    This avoids the search API's Slack federated search rate limits (429/504)
 *    that block all results when Slack's connector fails.
 * 2. Fallback: Individual search API calls with retry (if Chat API fails).
 *
 * Why not search API directly? Glean's search federates across all datasources
 * including Slack. The Slack RTS connector frequently rate-limits or times out,
 * causing the ENTIRE search to return 0 results — even for gdrive/confluence docs.
 */

import { config } from './config'
import { extractContentWithFallback, type GleanResponse } from './extract-content'

export interface SourceDoc {
  title: string
  content: string
}

/**
 * Extract document titles from reasoning chain and fetch their content.
 *
 * Primary: asks ADVANCED agent to summarize the listed docs (single API call,
 * no federated search rate limit issues).
 * Fallback: sequential search API calls with retry + timeoutMillis.
 */
export async function fetchSourceDocContent(
  reasoningChain: any[] | undefined
): Promise<SourceDoc[]> {
  if (!reasoningChain || reasoningChain.length === 0) return []

  // Extract unique document titles from the reasoning chain
  const titles = reasoningChain
    .filter(s => s.documentsRead)
    .flatMap(s => s.documentsRead)
    .map((d: any) => d.title)
    .filter((t: string | undefined): t is string => !!t)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 8)

  if (titles.length === 0) return []

  // Primary: batch fetch via Chat API
  const chatResult = await fetchViaChat(titles)
  if (chatResult.length > 0) {
    const retrieved = chatResult.filter(d => !d.content.includes('[Content not retrievable]'))
    if (retrieved.length > 0) {
      console.log(`  → Docs fetched: ${retrieved.length}/${titles.length} via Chat API`)
    }
    return chatResult
  }

  // Fallback: sequential search API calls
  console.log(`  → Chat API doc fetch failed, falling back to search API...`)
  const results: SourceDoc[] = []
  for (let i = 0; i < titles.length; i++) {
    const doc = await fetchSingleDoc(titles[i])
    results.push(doc)
    if (i < titles.length - 1) await new Promise(r => setTimeout(r, 500))
  }

  const retrieved = results.filter(d => !d.content.includes('[Content not retrievable]'))
  if (retrieved.length > 0) {
    console.log(`  → Docs fetched: ${retrieved.length}/${titles.length} via search API`)
  }

  return results
}

/**
 * Fetch doc content via ADVANCED Chat API in a single call.
 * The agent searches internally, bypassing federated search rate limits.
 */
async function fetchViaChat(titles: string[]): Promise<SourceDoc[]> {
  try {
    const titleList = titles.map((t, i) => `${i + 1}. "${t}"`).join('\n')

    const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify({
        messages: [{ fragments: [{ text:
          `I need brief content summaries of these specific company documents for a quality review. For each document, provide 3-5 sentences summarizing the key content. If you cannot find a document, say "[Content not retrievable]" for that entry.

Documents:
${titleList}

Respond in this exact format for each:
--- [document title] ---
[3-5 sentence summary of the document's content]` }] }],
        agentConfig: {
          agent: 'ADVANCED',
          toolSets: { enableCompanyTools: true },
        },
        saveChat: false,
        timeoutMillis: 60000,
      }),
      signal: AbortSignal.timeout(65000),
    })

    if (!resp.ok) {
      if (process.env.SEER_DEBUG) console.error(`  [DEBUG] Chat doc fetch HTTP ${resp.status}`)
      return []
    }

    const data = await resp.json() as GleanResponse
    const text = extractContentWithFallback(data)
    if (!text) {
      if (process.env.SEER_DEBUG) console.error(`  [DEBUG] Chat doc fetch: no content extracted`)
      return []
    }

    // Parse the structured response
    return titles.map(title => {
      // Find the section for this title
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`---\\s*${escapedTitle}\\s*---\\s*([\\s\\S]*?)(?=---\\s|$)`, 'i')
      const match = text.match(pattern)

      // Also try a looser match by title substring
      if (!match) {
        const loosePattern = new RegExp(`${escapedTitle.slice(0, 30)}[\\s\\S]*?\\n([\\s\\S]*?)(?=---\\s|$)`, 'i')
        const looseMatch = text.match(loosePattern)
        return {
          title,
          content: looseMatch?.[1]?.trim() || '[Content not retrievable]',
        }
      }

      return {
        title,
        content: match[1]?.trim() || '[Content not retrievable]',
      }
    })
  } catch {
    return []
  }
}

/**
 * Fallback: fetch content for a single document via search API.
 */
async function fetchSingleDoc(title: string): Promise<SourceDoc> {
  try {
    const resp = await fetch(`${config.gleanBackend}/rest/api/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify({
        query: title,
        pageSize: 1,
        timeoutMillis: 10000,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) return { title, content: '[Content not retrievable]' }

    const data = await resp.json() as any
    const results = data.results || []
    if (results.length === 0) return { title, content: '[Content not retrievable]' }

    const topResult = results[0]
    const snippets: string[] = []

    if (topResult.snippets) {
      for (const snippet of topResult.snippets) {
        if (snippet.snippet?.text) snippets.push(snippet.snippet.text)
      }
    }

    if (topResult.document?.body?.text) {
      snippets.push(topResult.document.body.text)
    }

    return {
      title,
      content: snippets.length > 0 ? snippets.join('\n\n') : '[Content not retrievable]',
    }
  } catch {
    return { title, content: '[Content not retrievable]' }
  }
}
