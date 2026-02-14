/**
 * Smart eval set generation agent
 *
 * Uses Glean Chat's built-in search grounding to:
 * 1. Find realistic input values based on the agent's schema
 * 2. For each input, search for source material the agent would use
 * 3. Generate expected outputs grounded in actual documents
 *
 * The Glean Chat API internally searches company knowledge when answering,
 * so each call effectively does search + reasoning.
 */

import { Glean } from '@gleanwork/api-client'
import { config } from './config'

const glean = new Glean({
  apiToken: config.gleanChatApiKey,
  instance: config.gleanInstance,
})

export interface SmartGenerateRequest {
  agentId: string
  agentName: string
  agentDescription: string
  schema: any  // Agent schema from /agents/{id}/schemas
  count: number
}

export interface SmartGeneratedCase {
  input: Record<string, string>  // Structured field values, NOT prompt strings
  query: string                  // Human-readable version for display
  expectedAnswer: string
}

export interface SmartGeneratedEvalSet {
  name: string
  description: string
  cases: SmartGeneratedCase[]
}

/**
 * Generate a grounded eval set using agentic search + chat
 */
export async function smartGenerate(req: SmartGenerateRequest): Promise<SmartGeneratedEvalSet> {
  const { agentId, agentName, agentDescription, schema, count } = req
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0

  console.log(`\n🤖 Smart generation for "${agentName}"`)
  console.log(`   Schema: ${hasFormInputs ? inputFields.join(', ') : 'chat-style'}`)

  // Step 1: Find realistic input values
  console.log(`\n1️⃣  Finding realistic inputs...`)
  const candidateInputs = await findRealisticInputs(
    agentName, agentDescription, inputSchema, inputFields, count
  )
  console.log(`   Found ${candidateInputs.length} candidates`)

  // Step 2: For each input, generate grounded expected output
  console.log(`\n2️⃣  Generating expected outputs...`)
  const cases: SmartGeneratedCase[] = []

  for (let i = 0; i < candidateInputs.length; i++) {
    const input = candidateInputs[i]
    console.log(`   [${i + 1}/${candidateInputs.length}] ${JSON.stringify(input).slice(0, 60)}...`)

    const expected = await generateExpectedOutput(
      agentName, agentDescription, input, inputFields
    )

    // Build human-readable query from structured input
    const query = hasFormInputs
      ? Object.entries(input).map(([k, v]) => `${k}: ${v}`).join(', ')
      : input[inputFields[0]] || Object.values(input)[0]

    cases.push({ input, query, expectedAnswer: expected })
  }

  return {
    name: agentName,
    description: `Grounded evaluation of "${agentName}" with ${cases.length} test cases generated from company data.`,
    cases,
  }
}

/**
 * Step 1: Use Glean Chat to find realistic input values
 * Chat internally searches company knowledge to ground its suggestions
 */
async function findRealisticInputs(
  agentName: string,
  agentDescription: string,
  inputSchema: Record<string, any>,
  inputFields: string[],
  count: number
): Promise<Record<string, string>[]> {
  const hasFormInputs = inputFields.length > 0

  // Build schema description
  let schemaDesc = ''
  if (hasFormInputs) {
    for (const [field, conf] of Object.entries(inputSchema)) {
      const c = conf as any
      schemaDesc += `- "${field}" (${c.type || 'string'})`
      if (c.description) schemaDesc += `: ${c.description}`
      if (c.enum) schemaDesc += ` [options: ${c.enum.join(', ')}]`
      schemaDesc += '\n'
    }
  }

  const prompt = hasFormInputs
    ? `I need to test a Glean agent called "${agentName}".
Description: ${agentDescription}

It takes these form inputs:
${schemaDesc}

Search through our company's data and find ${count} REAL, DIVERSE values I can use to test this agent.

For example, if the field is "account name", find actual customer/account names from our CRM, deals, kickoff decks, or success plans.
If the field is "employee name", find real people.
If the field is "query", generate realistic questions our users would ask.

Include a mix of:
- Common/well-known values (should produce good results)
- Edge cases (misspellings, unusual capitalization)
- Boundary cases (internal accounts, non-existent values)

Return ONLY the values, one per line, in this exact format:
${inputFields.map(f => `${f}: [value]`).join(' | ')}

Return exactly ${count} lines, nothing else.`

    : `I need to test a Glean agent called "${agentName}".
Description: ${agentDescription}

Generate ${count} realistic test queries that someone at this company would actually ask this agent.
Search our company data to ground these in real scenarios.

Include a mix of:
- Common questions (should produce good results)
- Specific questions referencing real projects/products/people
- Edge cases (vague queries, misspellings)

Return ONLY the queries, one per line. No numbering, no labels. Exactly ${count} lines.`

  const response = await glean.client.chat.create({
    messages: [{ author: 'USER', fragments: [{ text: prompt }] }],
    saveChat: false,
  })

  const text = extractText(response)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Parse into structured inputs
  if (hasFormInputs && inputFields.length === 1) {
    // Single field: each line is the value (strip any label prefix)
    return lines.slice(0, count).map(line => {
      const value = line.replace(new RegExp(`^${inputFields[0]}:\\s*`, 'i'), '').trim()
      return { [inputFields[0]]: value }
    })
  }

  if (hasFormInputs && inputFields.length > 1) {
    // Multiple fields: parse "field1: val | field2: val" format
    return lines.slice(0, count).map(line => {
      const input: Record<string, string> = {}
      const parts = line.split('|').map(p => p.trim())
      for (const part of parts) {
        const colonIdx = part.indexOf(':')
        if (colonIdx > 0) {
          const key = part.slice(0, colonIdx).trim()
          const val = part.slice(colonIdx + 1).trim()
          // Match to closest field name
          const matchedField = inputFields.find(
            f => f.toLowerCase() === key.toLowerCase()
          ) || inputFields[0]
          input[matchedField] = val
        }
      }
      // Fill in any missing fields
      for (const f of inputFields) {
        if (!input[f]) input[f] = ''
      }
      return input
    })
  }

  // Chat-style: each line is a query
  return lines.slice(0, count).map(line => ({ query: line }))
}

/**
 * Step 2: Generate a grounded expected output for a specific input
 * Uses Glean Chat to search for what the agent would find, then describe expected output
 */
async function generateExpectedOutput(
  agentName: string,
  agentDescription: string,
  input: Record<string, string>,
  inputFields: string[]
): Promise<string> {
  const inputStr = Object.entries(input)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(', ')

  const prompt = `I'm testing a Glean agent called "${agentName}".
Description: ${agentDescription}

The agent was given this input: ${inputStr}

Search our company's documents to find materials related to this input.
Based on what you find, describe what a GOOD response from this agent should look like.

Be specific:
- What topics/themes should the response cover?
- What documents or data sources should it reference?
- What format should the output be in?
- What would make the response WRONG or hallucinated?

If you cannot find relevant data for this input, say so — the expected behavior might be "agent should state no data found" rather than making things up.

Keep your response to 3-5 sentences. Be concrete, not generic.`

  const response = await glean.client.chat.create({
    messages: [{ author: 'USER', fragments: [{ text: prompt }] }],
    saveChat: false,
  })

  return extractText(response).trim()
}

/**
 * Extract only CONTENT text from Glean chat response
 * Skips UPDATE messages (search queries, "Searching...", etc.)
 */
function extractText(response: any): string {
  // First try CONTENT messages only (final answer)
  const contentText = response.messages
    ?.filter((m: any) => m.author === 'GLEAN_AI' && m.messageType === 'CONTENT')
    .flatMap((m: any) => m.fragments || [])
    .map((f: any) => f.text)
    .filter((t: any) => t)
    .join('') || ''

  if (contentText) return contentText

  // Fallback: all GLEAN_AI messages
  return response.messages
    ?.filter((m: any) => m.author === 'GLEAN_AI')
    .flatMap((m: any) => m.fragments || [])
    .map((f: any) => f.text)
    .filter((t: any) => t)
    .join('') || ''
}
