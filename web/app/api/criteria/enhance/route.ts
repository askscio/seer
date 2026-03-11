import { NextResponse } from 'next/server'
import { config } from '../../../../../src/lib/config'
import { extractContentWithFallback, type GleanResponse } from '../../../../../src/lib/extract-content'

export async function POST(request: Request) {
  try {
    const { name, draft, scaleType } = await request.json()

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const scaleDescriptions: Record<string, string> = {
      '5-level': `Use this 5-level categorical scale:
- full: [describe what excellent looks like for this dimension]
- substantial: [describe what good looks like — minor gaps only]
- partial: [describe what mixed/okay looks like — real value but incomplete]
- minimal: [describe what poor looks like — little useful signal]
- failure: [describe what failing looks like — wrong, missing, or harmful]`,
      '3-level': `Use this 3-level scale:
- low: [describe what low risk / high quality looks like]
- medium: [describe what moderate risk / mixed quality looks like]
- high: [describe what high risk / low quality looks like]`,
      binary: `Use a binary scale:
- yes: [describe what passing looks like]
- no: [describe what failing looks like]`,
    }

    const prompt = `You are helping create a custom evaluation rubric for judging AI agent responses.

The dimension is called: "${name}"
${draft ? `\nThe user provided this initial description: "${draft}"` : ''}
Scale type: ${scaleType || '5-level'}

Write a clear, specific rubric for a judge LLM to evaluate an AI agent's response on this dimension. Follow these guidelines:

1. Start with a one-line description of what this dimension measures
2. Provide specific instructions for what to look for in the response
3. Define each scale level with concrete behavioral descriptions — what does each level look like in practice?

${scaleDescriptions[scaleType || '5-level']}

Here are examples of well-written rubrics from our existing dimensions:

EXAMPLE 1 (Topical Coverage):
"Decompose the eval guidance into discrete themes. For each theme, classify the response's coverage as COVERED (present with useful detail), TOUCHED (mentioned without depth), or MISSING (absent). Then assign a category:
- full: All major themes COVERED. User could act on this alone.
- substantial: Most themes COVERED (75%+). One or two minor gaps.
- partial: About half the themes covered. Real value but needs supplementation.
- minimal: Touches on the topic but delivers little guided content.
- failure: Wrong topic, refusal, error, or no meaningful overlap."

EXAMPLE 2 (Response Quality):
"Evaluate the quality of the response independent of factual content:
- full: Clear structure, concise, actionable. Specific language (not boilerplate). Appropriate format.
- substantial: Good structure and mostly concise. Minor formatting or organizational issues.
- partial: Understandable but poorly organized. Too verbose, too terse, or wrong format.
- minimal: Hard to parse. Wall of text, jumbled structure, or significant formatting problems.
- failure: Unusable output format or no meaningful output.
Evaluate information density, not length."

Now write the rubric for "${name}". Be specific to this dimension — don't write a generic rubric. Output ONLY the rubric text, no preamble.`

    const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify({
        messages: [{ fragments: [{ text: prompt }] }],
        agentConfig: { agent: 'DEFAULT', modelSetId: 'OPUS_4_6_VERTEX' },
        saveChat: false,
        timeoutMillis: 30000,
      }),
    })

    if (!resp.ok) {
      return NextResponse.json({ error: 'Failed to generate rubric' }, { status: 500 })
    }

    const data = await resp.json() as GleanResponse
    const rubric = extractContentWithFallback(data)

    if (!rubric) {
      return NextResponse.json({ error: 'No rubric generated' }, { status: 500 })
    }

    return NextResponse.json({ rubric: rubric.trim() })
  } catch (error) {
    console.error('Error enhancing rubric:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enhance rubric' },
      { status: 500 }
    )
  }
}
