import { Glean } from '@gleanwork/api-client'
import { config } from './config'

const glean = new Glean({
  apiToken: config.gleanApiKey,
  instance: config.gleanInstance
})

export interface GenerateEvalSetRequest {
  agentId: string
  count: number  // Number of test cases to generate
  schema: any    // Agent schema from /agents/{id}/schemas
  agentName?: string  // Optional: Agent name from API
}

export interface GeneratedEvalSet {
  name: string
  description: string
  cases: Array<{
    query: string
    expectedAnswer?: string
    context?: string
  }>
}

/**
 * Generate an eval set using Glean chat (grounded in company knowledge)
 */
export async function generateEvalSet(
  req: GenerateEvalSetRequest
): Promise<GeneratedEvalSet> {
  const { agentId, count, schema, agentName } = req

  // Step 1: Generate set name and description
  const setMetadata = await generateSetMetadata(agentId, schema, agentName)

  // Step 2: Generate test cases
  const cases = await generateTestCases(agentId, schema, count)

  return {
    name: setMetadata.name,
    description: setMetadata.description,
    cases
  }
}

/**
 * Generate eval set metadata (name + description) via Glean chat
 */
async function generateSetMetadata(
  agentId: string,
  schema: any,
  agentName?: string
): Promise<{ name: string; description: string }> {
  // If we have the agent name from the API, use it directly for the eval set name
  if (agentName) {
    // Just generate a description
    const inputFields = Object.keys(schema.input_schema || {})
    const hasFormInputs = inputFields.length > 0

    let schemaDetails = ''
    if (hasFormInputs) {
      schemaDetails = 'Form Fields:\n'
      for (const [field, config] of Object.entries(schema.input_schema)) {
        const fieldConfig = config as any
        schemaDetails += `- ${field}: ${fieldConfig.type || 'unknown type'}`
        if (fieldConfig.description) {
          schemaDetails += ` (${fieldConfig.description})`
        }
        schemaDetails += '\n'
      }
    }

    const prompt = `You are creating an evaluation set for a Glean agent.

Agent Name: ${agentName}
Input Type: ${hasFormInputs ? 'Form-based' : 'Chat-style'}

${schemaDetails}

Write a brief description (1-2 sentences) explaining what capabilities this eval set will test for this agent.

Format: Just provide the description, no label.`

    const response = await glean.client.chat.create({
      messages: [
        {
          author: 'USER',
          fragments: [{ text: prompt }]
        }
      ],
      saveChat: false
    })

    const description = extractResponseText(response).trim()

    return {
      name: agentName,
      description: description || `Evaluation set for ${agentName}`
    }
  }

  // Fallback: Generate both name and description if no agent name provided
  const inputFields = Object.keys(schema.input_schema || {})
  const hasFormInputs = inputFields.length > 0

  let schemaDetails = ''
  if (hasFormInputs) {
    schemaDetails = 'Form Fields:\n'
    for (const [field, config] of Object.entries(schema.input_schema)) {
      const fieldConfig = config as any
      schemaDetails += `- ${field}: ${fieldConfig.type || 'unknown type'}`
      if (fieldConfig.description) {
        schemaDetails += ` (${fieldConfig.description})`
      }
      schemaDetails += '\n'
    }
  }

  const prompt = `You are helping create an evaluation set for a Glean agent.

Agent ID: ${agentId}
Input Type: ${hasFormInputs ? 'Form-based' : 'Chat-style'}

${schemaDetails}

Your task:
1. Generate a concise name (2-5 words) that describes the agent's function
2. Write a brief description (1-2 sentences) explaining what capabilities this eval set will test

Format your response EXACTLY like this:
NAME: [name here]
DESCRIPTION: [description here]`

  const response = await glean.client.chat.create({
    messages: [
      {
        author: 'USER',
        fragments: [{ text: prompt }]
      }
    ],
    saveChat: false
  })

  const text = extractResponseText(response)

  // Parse response
  const nameMatch = text.match(/NAME:\s*(.+?)(?=\n|DESCRIPTION|$)/i)
  const descMatch = text.match(/DESCRIPTION:\s*(.+?)(?=\n\n|$)/i)

  return {
    name: nameMatch?.[1]?.trim() || `Agent ${agentId.slice(0, 8)} Evaluation`,
    description: descMatch?.[1]?.trim() || 'Generated evaluation set'
  }
}

/**
 * Generate test cases via Glean chat (grounded in company data)
 */
async function generateTestCases(
  agentId: string,
  schema: any,
  count: number
): Promise<Array<{ query: string; expectedAnswer?: string }>> {
  const inputFields = Object.keys(schema.input_schema || {})
  const hasFormInputs = inputFields.length > 0

  // Build detailed schema description
  let schemaDescription = ''
  if (hasFormInputs) {
    schemaDescription = '\nAgent Schema (Form Fields):\n'
    for (const [field, config] of Object.entries(schema.input_schema)) {
      const fieldConfig = config as any
      schemaDescription += `- ${field}:\n`
      schemaDescription += `  Type: ${fieldConfig.type || 'unknown'}\n`
      if (fieldConfig.description) {
        schemaDescription += `  Description: ${fieldConfig.description}\n`
      }
      if (fieldConfig.enum) {
        schemaDescription += `  Options: ${JSON.stringify(fieldConfig.enum)}\n`
      }
    }
  }

  const prompt = `You are generating test cases for a Glean agent evaluation.

Agent ID: ${agentId}
Input Type: ${hasFormInputs ? 'Form-based (structured inputs)' : 'Chat-style (conversational)'}
${schemaDescription}

IMPORTANT INSTRUCTIONS:
1. First, understand what this agent does based on its input fields
2. Think about realistic scenarios where someone would use this agent
3. Generate ${count} diverse, realistic test cases that:
   - Cover different user scenarios and use cases
   - Test edge cases and boundary conditions
   - Reflect real queries someone at this company would ask
   ${hasFormInputs ? '- Exercise different combinations of the form field values' : '- Vary in complexity and specificity'}
   - Are grounded in this company's actual business context

4. For EACH test case, provide:
   - Query: ${hasFormInputs ? 'The specific values for each form field, written as natural text' : 'A realistic user question'}
   - Expected: What a good response should contain (be specific)

${hasFormInputs ? `
EXAMPLE for form-based agents:
If fields are [account_name, date_range], a test might be:
Query: Find sales data for Acme Corp from Q4 2025
Expected: Should return revenue, deal count, and key contacts for Acme Corp in Q4 2025
` : `
EXAMPLE for chat-based agents:
Query: What is our company's revenue target for Q1?
Expected: Should cite the current quarterly planning document and provide the specific number
`}

Generate ${count} cases following this EXACT format:

CASE 1:
Query: [realistic query here]
Expected: [specific expected behavior/content]

---

CASE 2:
Query: [realistic query here]
Expected: [specific expected behavior/content]

---

(Continue for all ${count} cases)

Remember: These test cases should reflect REAL scenarios from this company's operations.`

  const response = await glean.client.chat.create({
    messages: [
      {
        author: 'USER',
        fragments: [{ text: prompt }]
      }
    ],
    saveChat: false
  })

  const text = extractResponseText(response)

  // Parse test cases from response
  const caseRegex = /CASE\s+\d+:\s*Query:\s*(.+?)\s*(?:Expected:\s*(.+?))?\s*(?=---|CASE\s+\d+:|$)/gi
  const matches = [...text.matchAll(caseRegex)]

  const parsedCases = matches.map(match => ({
    query: match[1].trim(),
    expectedAnswer: match[2]?.trim()
  }))

  // Ensure we return exactly count cases (or fewer if parsing failed)
  return parsedCases.slice(0, count)
}

/**
 * Extract CONTENT text from Glean chat response (skip intermediate UPDATE messages)
 */
function extractResponseText(response: any): string {
  const contentText = response.messages
    ?.filter((m: any) => m.author === 'GLEAN_AI' && m.messageType === 'CONTENT')
    .flatMap((m: any) => m.fragments || [])
    .map((f: any) => f.text)
    .filter((t: any) => t)
    .join('') || ''

  if (contentText) return contentText

  return response.messages
    ?.filter((m: any) => m.author === 'GLEAN_AI')
    .flatMap((m: any) => m.fragments || [])
    .map((f: any) => f.text)
    .filter((t: any) => t)
    .join('') || ''
}
