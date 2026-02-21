/**
 * Source document content retrieval for faithfulness judging
 *
 * Fetches actual document content for sources identified in the agent's
 * reasoning chain. Called between agent execution and faithfulness judging
 * so the judge receives real content instead of just titles.
 *
 * Why: The faithfulness judge needs to compare response claims against
 * what the documents actually say — not just their titles. By fetching
 * content ourselves, we control exactly what the judge reads and can
 * use DEFAULT agent mode (with modelSetId) instead of ADVANCED.
 */

import { config } from './config'

export interface SourceDoc {
  title: string
  content: string
}

/**
 * Extract document titles from reasoning chain and fetch their content
 * via Glean search API.
 *
 * - Extracts titles from `step.documentsRead`
 * - Caps at 10 documents (focused context > exhaustive noise)
 * - Searches in parallel via Promise.all()
 * - Returns { title, content }[] — content is joined text snippets
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
    .filter((t, i, arr) => arr.indexOf(t) === i)  // deduplicate
    .slice(0, 10)

  if (titles.length === 0) return []

  // Fetch content for each document in parallel
  const results = await Promise.all(
    titles.map(title => fetchSingleDoc(title))
  )

  return results
}

/**
 * Fetch content for a single document by searching for its title.
 * Uses Glean search API with pageSize: 1 to get the top match.
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
        requestOptions: { facetFilters: [] },
      }),
    })

    if (!resp.ok) {
      return { title, content: '[Content not retrievable]' }
    }

    const data = await resp.json() as any
    const results = data.results || []

    if (results.length === 0) {
      return { title, content: '[Content not retrievable]' }
    }

    // Extract text snippets from the top result
    const topResult = results[0]
    const snippets: string[] = []

    // Body text / snippet
    if (topResult.snippets) {
      for (const snippet of topResult.snippets) {
        if (snippet.snippet?.text) snippets.push(snippet.snippet.text)
      }
    }

    // Document body if available
    if (topResult.document?.body?.text) {
      snippets.push(topResult.document.body.text)
    }

    const content = snippets.length > 0
      ? snippets.join('\n\n')
      : '[Content not retrievable]'

    return { title, content }
  } catch {
    return { title, content: '[Content not retrievable]' }
  }
}
