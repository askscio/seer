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
  simulatorContext?: string   // Persona: who the simulated user is
  simulatorStrategy?: string  // Strategy: how to interact with this agent for this case
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

  // Step 3: For autonomous agents, generate simulator context + strategy per case
  if (isAutonomous) {
    console.log(`\n3️⃣  Generating simulator context + strategy...`)
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      const displayVal = c.query.slice(0, 60)
      console.log(`   [${i + 1}/${cases.length}] ${displayVal}`)
      onProgress?.({ phase: 'simulator', message: `Generating simulator strategy for "${displayVal}"...`, current: i + 1, total: cases.length })

      const { context, strategy } = await generateSimulatorContextAndStrategy(
        agentName, agentDescription, c.query, c.evalGuidance
      )
      cases[i].simulatorContext = context
      cases[i].simulatorStrategy = strategy
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
 * Step 3: Generate simulator context (persona) and strategy for an autonomous agent.
 *
 * Two outputs:
 * - simulatorContext: WHO the user is (role, knowledge, goal, style)
 * - simulatorStrategy: HOW to interact with this agent (what to expect, how to respond)
 *
 * The strategy is informed by the agent's description and the eval guidance,
 * but translated into user-facing behavioral instructions. This prevents the
 * simulator from mimicking the agent's behavior patterns.
 */
async function generateSimulatorContextAndStrategy(
  agentName: string,
  agentDescription: string,
  query: string,
  evalGuidance: string,
): Promise<{ context: string; strategy: string }> {
  // Generate both in a single call to reduce latency
  const text = await askAgent(
    `I'm building a simulated user to test a conversational AI agent called "${agentName}".
Description: ${agentDescription}

The test scenario: A user asks "${query}"

I need TWO things. Return them in the exact format below.

=== PERSONA ===
Describe who the simulated user is in 2-3 sentences:
- Job title and team
- What specific details they can provide if asked (real account names, metrics, dates from our company data)
- Their communication style (concise? detailed? busy?)

=== STRATEGY ===
Describe how the simulated user should interact with this agent for this specific scenario in 3-5 bullet points:
- What will the agent likely do first? (ask clarifying questions, propose options, dive right in, etc.)
- For each expected agent behavior, what should the user do in response?
- What specific information should the user provide when asked?
- Critical: The user should NEVER ask the agent questions or probe for more — that's the agent's job. The user ANSWERS questions, PROVIDES details, and CONFIRMS or REDIRECTS. Users are concise — 1-3 sentences per reply.

Be specific to this scenario. Use real company context where relevant.`
  )

  // Parse the two sections
  const personaMatch = text.match(/=== PERSONA ===\s*([\s\S]*?)(?:=== STRATEGY ===|$)/i)
  const strategyMatch = text.match(/=== STRATEGY ===\s*([\s\S]*?)$/i)

  return {
    context: personaMatch?.[1]?.trim() || text.trim(),
    strategy: strategyMatch?.[1]?.trim() || '',
  }
}
