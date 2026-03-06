/**
 * Source document content retrieval for faithfulness judging
 *
 * Fetches actual document content for sources identified in the agent's
 * reasoning chain. Uses Glean's getdocuments API to read indexed content
 * directly by URL — no search federation, no Slack rate limit issues.
 *
 * Flow:
 * 1. Extract doc URLs from the agent's reasoning chain
 * 2. Batch fetch via POST /rest/api/v1/getdocuments with DOCUMENT_CONTENT
 * 3. Return { title, content }[] for the faithfulness judge
 */

import { config } from './config'

export interface SourceDoc {
  title: string
  content: string
}

/**
 * Extract document URLs from reasoning chain and fetch their content
 * via the getdocuments API (direct content read, no search federation).
 *
 * Caps at 8 documents. Batches into a single API call.
 */
export async function fetchSourceDocContent(
  reasoningChain: any[] | undefined
): Promise<SourceDoc[]> {
  if (!reasoningChain || reasoningChain.length === 0) return []

  // Extract unique documents with URLs from the reasoning chain
  const docs = reasoningChain
    .filter(s => s.documentsRead)
    .flatMap(s => s.documentsRead)
    .filter((d: any) => d.url && d.title)
    .filter((d: any, i: number, arr: any[]) =>
      arr.findIndex((x: any) => x.url === d.url) === i  // deduplicate by URL
    )
    .slice(0, 8)

  if (docs.length === 0) return []

  // Batch fetch all docs in a single API call
  const results = await fetchDocsByUrl(docs)

  const retrieved = results.filter(d => !d.content.includes('[Content not retrievable]'))
  if (retrieved.length > 0 || results.length > 0) {
    console.log(`  → Docs fetched: ${retrieved.length}/${docs.length} retrieved`)
  }

  return results
}

/**
 * Fetch document content by URL using the getdocuments API.
 * Single batch call — no search federation, no Slack rate limits.
 */
async function fetchDocsByUrl(
  docs: Array<{ title: string; url: string }>
): Promise<SourceDoc[]> {
  try {
    const resp = await fetch(`${config.gleanBackend}/rest/api/v1/getdocuments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify({
        documentSpecs: docs.map(d => ({ url: d.url })),
        includeFields: ['DOCUMENT_CONTENT'],
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!resp.ok) {
      if (process.env.SEER_DEBUG) {
        console.error(`  [DEBUG] getdocuments error: ${resp.status}`)
      }
      return docs.map(d => ({ title: d.title, content: '[Content not retrievable]' }))
    }

    const data = await resp.json() as any

    // Response format: { documents: { [url]: { content: { fullTextList: [...] }, ... } } }
    const docMap = data.documents || {}

    return docs.map(d => {
      const docData = docMap[d.url]
      if (!docData) {
        return { title: d.title, content: '[Content not retrievable]' }
      }

      // Extract content from fullTextList
      const fullText = docData.content?.fullTextList
      if (fullText && Array.isArray(fullText) && fullText.length > 0) {
        // Join text sections, cap at ~4000 chars to keep judge context focused
        const joined = fullText.join('\n').slice(0, 4000)
        return { title: d.title, content: joined }
      }

      // Fallback to body text
      const body = docData.body?.text
      if (body) {
        return { title: d.title, content: body.slice(0, 4000) }
      }

      return { title: d.title, content: '[Content not retrievable]' }
    })
  } catch (err) {
    if (process.env.SEER_DEBUG) {
      console.error(`  [DEBUG] getdocuments exception:`, err)
    }
    return docs.map(d => ({ title: d.title, content: '[Content not retrievable]' }))
  }
}
