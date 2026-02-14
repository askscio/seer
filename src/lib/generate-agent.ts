/**
 * Smart eval set generation using Glean's ADVANCED toolkit agent
 *
 * Uses raw fetch (not SDK) because the SDK doesn't support the ADVANCED
 * agent mode yet. The ADVANCED agent has company tools enabled (search,
 * people, CRM, etc.) and can find real data to ground eval cases.
 *
 * Two-phase approach:
 * 1. Ask the agent to find realistic input values for the agent's schema
 * 2. For each input, ask the agent what a good output should look like
 */

import { config } from './config'

export interface SmartGenerateRequest {
  agentId: string
  agentName: string
  agentDescription: string
  schema: any
  count: number
}

export interface SmartGeneratedCase {
  input: Record<string, string>
  query: string
  expectedAnswer: string
}

export interface SmartGeneratedEvalSet {
  name: string
  description: string
  cases: SmartGeneratedCase[]
}

/**
 * Call Glean's ADVANCED chat agent with company tools enabled
 */
async function askAgent(query: string): Promise<string> {
  const resp = await fetch(`${config.gleanBackend}/rest/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.gleanApiKey}`,
    },
    body: JSON.stringify({
      messages: [{ fragments: [{ text: query }] }],
      agentConfig: {
        agent: 'ADVANCED',
        toolSets: { enableCompanyTools: true },
      },
      saveChat: false,
      timeoutMillis: 60000,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Chat API error: ${resp.status} - ${err}`)
  }

  const data = await resp.json() as any
  let text = ''
  for (const msg of data.messages ?? []) {
    if (msg.author === 'GLEAN_AI' && msg.messageType === 'CONTENT') {
      for (const f of msg.fragments ?? []) {
        if (f.text) text += f.text
      }
    }
  }
  return text
}

/**
 * Generate a grounded eval set
 */
export async function smartGenerate(req: SmartGenerateRequest): Promise<SmartGeneratedEvalSet> {
  const { agentId, agentName, agentDescription, schema, count } = req
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0

  console.log(`\n🤖 Smart generation for "${agentName}"`)
  console.log(`   Schema: ${hasFormInputs ? inputFields.join(', ') : 'chat-style'}`)

  // Step 1: Find realistic input values using company tools
  console.log(`\n1️⃣  Finding realistic inputs...`)
  const candidateInputs = await findRealisticInputs(
    agentName, agentDescription, inputFields, count
  )
  console.log(`   Found ${candidateInputs.length} candidates`)

  // Step 2: For each input, generate grounded expected output
  console.log(`\n2️⃣  Generating expected outputs...`)
  const cases: SmartGeneratedCase[] = []

  for (let i = 0; i < candidateInputs.length; i++) {
    const input = candidateInputs[i]
    const displayVal = Object.values(input)[0] || ''
    console.log(`   [${i + 1}/${candidateInputs.length}] ${displayVal}`)

    const expected = await generateExpectedOutput(agentName, agentDescription, input)

    const query = hasFormInputs
      ? Object.values(input)[0] || ''  // For single-field forms, just the value
      : input.query || Object.values(input)[0] || ''

    cases.push({ input, query, expectedAnswer: expected })
  }

  return {
    name: agentName,
    description: `Evaluation of "${agentName}" with ${cases.length} test cases grounded in company data.`,
    cases,
  }
}

/**
 * Step 1: Find realistic input values using ADVANCED agent with company tools
 */
async function findRealisticInputs(
  agentName: string,
  agentDescription: string,
  inputFields: string[],
  count: number
): Promise<Record<string, string>[]> {
  const fieldName = inputFields[0] || 'query'

  const text = await askAgent(
    `I'm testing a Glean agent called "${agentName}".
Description: ${agentDescription}

It takes a form input field called "${fieldName}".

Search our company data (CRM, success plans, accounts, etc.) and give me exactly ${count} real, diverse values for "${fieldName}" that I can use to test this agent.

Include a mix of:
- Well-known values that should produce good results
- At least 1 edge case (misspelling, unusual casing, or abbreviation)
- At least 1 boundary case (internal/test account or non-existent value)

Return ONLY a plain numbered list. No explanations, no markdown formatting, no bullets. Just:
1. Value one
2. Value two
...`
  )

  // Parse numbered list
  const lines = text.split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())  // Strip "1. " or "1) " prefix
    .filter(l => l.length > 0 && !l.startsWith('---'))
    .slice(0, count)

  return lines.map(val => ({ [fieldName]: val }))
}

/**
 * Step 2: Generate expected output for a specific input using ADVANCED agent
 */
async function generateExpectedOutput(
  agentName: string,
  agentDescription: string,
  input: Record<string, string>
): Promise<string> {
  const inputStr = Object.entries(input)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(', ')

  const text = await askAgent(
    `I'm testing a Glean agent called "${agentName}".
Description: ${agentDescription}

The agent was given this input: ${inputStr}

Search our company's documents for materials related to this input. Then describe what a GOOD response from this agent should look like in 3-5 sentences:
- What topics/themes should it cover based on what you found?
- What sources should it reference?
- What would make the response WRONG or hallucinated?
- If no relevant data exists, say the expected behavior is "agent should state no data found."

Be specific and concrete. No generic advice.`
  )

  return text.trim()
}
