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
import { extractContentWithFallback } from './extract-content'

export type GenerateProgressEvent =
  | { phase: 'schema'; message: string }
  | { phase: 'inputs'; message: string }
  | { phase: 'guidance'; message: string; current: number; total: number }
  | { phase: 'simulator'; message: string; current: number; total: number }
  | { phase: 'case'; case: SmartGeneratedCase; current: number; total: number }
  | { phase: 'done'; message: string }

export interface SmartGenerateRequest {
  agentId: string
  agentName: string
  agentDescription: string
  schema: any
  count: number
  agentType?: string  // 'autonomous' triggers simulator context generation
  onProgress?: (event: GenerateProgressEvent) => void
}

export interface SmartGeneratedCase {
  input: Record<string, string>
  query: string
  evalGuidance: string
  simulatorContext?: string  // For autonomous/multi-turn agents
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
  return extractContentWithFallback(data)
}

/**
 * Generate a grounded eval set
 */
export async function smartGenerate(req: SmartGenerateRequest): Promise<SmartGeneratedEvalSet> {
  const { agentId, agentName, agentDescription, schema, count, agentType, onProgress } = req
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0
  const isAutonomous = agentType === 'autonomous'

  console.log(`\n🤖 Smart generation for "${agentName}"`)
  console.log(`   Schema: ${hasFormInputs ? inputFields.join(', ') : 'chat-style'}`)
  if (isAutonomous) console.log(`   Type: autonomous (will generate simulator context)`)
  onProgress?.({ phase: 'schema', message: `Reading agent schema for "${agentName}"` })

  // Step 1: Find realistic input values using company tools
  console.log(`\n1️⃣  Finding realistic inputs...`)
  onProgress?.({ phase: 'inputs', message: 'Finding realistic inputs with Glean...' })
  const candidateInputs = await findRealisticInputs(
    agentName, agentDescription, inputFields, count
  )
  console.log(`   Found ${candidateInputs.length} candidates`)

  // Step 2: For each input, generate grounded eval guidance
  console.log(`\n2️⃣  Generating eval guidance...`)
  const cases: SmartGeneratedCase[] = []

  for (let i = 0; i < candidateInputs.length; i++) {
    const input = candidateInputs[i]
    const displayVal = Object.values(input)[0] || ''
    console.log(`   [${i + 1}/${candidateInputs.length}] ${displayVal}`)
    onProgress?.({ phase: 'guidance', message: `Generating guidance for "${displayVal}"...`, current: i + 1, total: candidateInputs.length })

    const expected = await generateExpectedOutput(agentName, agentDescription, input)

    const query = hasFormInputs
      ? Object.values(input)[0] || ''
      : input.query || Object.values(input)[0] || ''

    const newCase: SmartGeneratedCase = { input, query, evalGuidance: expected }
    cases.push(newCase)
    onProgress?.({ phase: 'case', case: newCase, current: i + 1, total: candidateInputs.length })
  }

  // Step 3: For autonomous agents, generate simulator context per case
  if (isAutonomous) {
    console.log(`\n3️⃣  Generating simulator context...`)
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      const displayVal = c.query.slice(0, 60)
      console.log(`   [${i + 1}/${cases.length}] ${displayVal}`)
      onProgress?.({ phase: 'simulator', message: `Generating simulator context for "${displayVal}"...`, current: i + 1, total: cases.length })

      cases[i].simulatorContext = await generateSimulatorContext(
        agentName, agentDescription, c.query, c.evalGuidance
      )
    }
  }

  onProgress?.({ phase: 'done', message: `Generated ${cases.length} test cases` })

  return {
    name: agentName,
    description: `Evaluation of "${agentName}" with ${cases.length} test cases grounded in company data.`,
    cases,
  }
}

/**
 * Step 1: Find realistic input values using ADVANCED agent with company tools.
 * For single-field agents, returns a list of values for that field.
 * For multi-field agents, returns structured objects with values for ALL fields.
 */
async function findRealisticInputs(
  agentName: string,
  agentDescription: string,
  inputFields: string[],
  count: number
): Promise<Record<string, string>[]> {
  if (inputFields.length === 0) {
    // Chat-style: generate natural language queries
    const text = await askAgent(
      `I'm testing a Glean agent called "${agentName}".
Description: ${agentDescription}

Generate exactly ${count} realistic, diverse questions that someone at this company would ask this agent.

Include a mix of:
- Common questions that should produce good results
- At least 1 edge case (vague or ambiguous query)
- At least 1 boundary case (off-topic or unanswerable)

Return ONLY a plain numbered list. No explanations. Just:
1. Question one
2. Question two
...`
    )

    const lines = text.split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('---'))
      .slice(0, count)

    return lines.map(val => ({ query: val }))
  }

  if (inputFields.length === 1) {
    // Single-field: generate values for that field
    const fieldName = inputFields[0]
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

    const lines = text.split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('---'))
      .slice(0, count)

    return lines.map(val => ({ [fieldName]: val }))
  }

  // Multi-field: generate structured input combinations
  const fieldList = inputFields.map(f => `"${f}"`).join(', ')
  const text = await askAgent(
    `I'm testing a Glean agent called "${agentName}".
Description: ${agentDescription}

It takes these form inputs: ${fieldList}

Search our company data and give me exactly ${count} realistic test input combinations. Each combination should have a value for every field.

Include a mix of:
- Well-known values that should produce good results
- At least 1 edge case (misspelling, unusual casing)
- At least 1 case where optional fields are left blank

Return each combination on its own line using this EXACT format (pipe-separated):
${inputFields.join(' | ')}

Example format:
value1 | value2 | value3

Return ONLY the ${count} lines of values. No headers, no numbering, no explanations.`
  )

  const lines = text.split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(l => l.length > 0 && !l.startsWith('---') && l.includes('|'))
    .slice(0, count)

  return lines.map(line => {
    const values = line.split('|').map(v => v.trim())
    const result: Record<string, string> = {}
    inputFields.forEach((field, i) => {
      result[field] = values[i] || ''
    })
    return result
  })
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

/**
 * Step 3: Generate simulator context for an autonomous/multi-turn agent.
 * Describes who the simulated user is and how they should respond to follow-ups.
 */
async function generateSimulatorContext(
  agentName: string,
  agentDescription: string,
  query: string,
  evalGuidance: string,
): Promise<string> {
  const text = await askAgent(
    `I'm testing a conversational Glean agent called "${agentName}".
Description: ${agentDescription}

This agent is multi-turn — it may ask the user follow-up questions before giving a final answer.

The user's initial query is: "${query}"

What a good final outcome looks like: ${evalGuidance}

Write a brief "simulator context" that describes how a simulated user should behave during this conversation. Include:
1. **Role**: Who is the user? (job title, team, what they're working on)
2. **Knowledge**: What specific details can they provide if asked? (account names, metrics, dates, project names — use real examples from our company data)
3. **Goal**: What outcome are they trying to achieve?
4. **Style**: How do they communicate? (concise, detailed, impatient, collaborative)

Keep it to 3-5 sentences. Be specific and grounded in real company context, not generic.`
  )

  return text.trim()
}
