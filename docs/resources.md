# Glean API Resources

**Documentation for Seer's Glean API integration**

---

## Project Documentation

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System architecture, component design, data flow |
| [features.md](./features.md) | Feature tracking, development log, roadmap |
| [issues.md](./issues.md) | Bug tracking, technical debt, known limitations |
| [resources.md](./resources.md) | **This file** - Glean API integration guide |

---

## Overview

Seer uses **two different Glean APIs** for different purposes:

1. **Glean Agents API (REST)** - For running custom agents built in Glean
2. **Glean Chat API (TypeScript SDK)** - For judge/chat interactions

---

## API Keys

**Two separate API keys are required:**

| Key | Purpose | Used For | Environment Variable |
|-----|---------|----------|---------------------|
| **Agent API Key** | Execute custom Glean agents | Running agents built in Agent Builder | `GLEAN_AGENT_API_KEY` |
| **Chat API Key** | Chat/judge calls | LLM-as-judge evaluations via chat | `GLEAN_CHAT_API_KEY` |

**How to get API keys:**
- **Agent API Key:** Glean Admin → API Tokens → "REST API Token (for agents API)"
- **Chat API Key:** Glean Admin → API Tokens → "REST API Token (for client APIs)"

---

## 1. Glean Agents API (REST)

**Used for:** Running custom agents built in Glean's Agent Builder

### Endpoints

```
Base URL: https://{instance}-be.glean.com/rest/api/v1
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/agents/{agent_id}` | Retrieve agent details |
| `GET` | `/agents/{agent_id}/schemas` | Get agent input/output schemas |
| `POST` | `/agents/runs/wait` | Execute agent (blocking) |
| `POST` | `/agents/runs/stream` | Execute agent (streaming SSE) |
| `POST` | `/agents/search` | Search for agents |

### Agent Execution

**Endpoint:** `POST /agents/runs/wait`

**Request Format:**

Agents can have two types of inputs:

#### A. Form-Based Agents (Input Fields)

Agents with form fields defined in Agent Builder:

```typescript
POST /rest/api/v1/agents/runs/wait
{
  "agent_id": "abc123",
  "input": {
    "field_name": "value",  // Field names from agent schema
    "another_field": "value"
  }
}
```

**Example:**
```typescript
// Agent has input schema: { "account name": { "type": "string" } }
{
  "agent_id": "3385428f65c54c94a8da40aa0a8243f3",
  "input": {
    "account name": "Acme Corp"
  }
}
```

#### B. Chat-Style Agents (Messages)

Agents without form inputs (conversational):

```typescript
POST /rest/api/v1/agents/runs/wait
{
  "agent_id": "abc123",
  "messages": [
    {
      "role": "USER",
      "content": [
        {
          "text": "Your query here",
          "type": "text"
        }
      ]
    }
  ]
}
```

### Getting Agent Schema

**Critical:** Always fetch the agent's schema first to determine input type:

```typescript
GET /rest/api/v1/agents/{agent_id}/schemas

Response:
{
  "agent_id": "abc123",
  "input_schema": {
    "field_name": { "type": "string" }  // If present, use form-based input
  },
  "output_schema": { ... }
}
```

**Decision logic:**
- If `input_schema` has keys → Use `input` object (form-based)
- If `input_schema` is empty → Use `messages` array (chat-style)

### Response Format

```typescript
{
  "run": {
    "agent_id": "abc123",
    "status": "completed"
  },
  "messages": [
    {
      "role": "GLEAN_AI",
      "content": [
        {
          "text": "Agent response text",
          "type": "text"
        }
      ]
    }
  ]
}
```

### Seer Implementation

See: `src/data/glean.ts`

```typescript
// Auto-detects agent type and uses correct format
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string
): Promise<AgentResult>
```

**Features:**
- Fetches agent schema automatically
- Detects form vs chat input type
- Maps query to first form field for form-based agents
- Uses messages array for chat-based agents
- Extracts response text from GLEAN_AI messages

---

## 2. Glean Chat API (TypeScript SDK)

**Used for:** Judge evaluations via Glean chat

### Installation

```bash
bun add @gleanwork/api-client
```

### Initialization

```typescript
import { Glean } from '@gleanwork/api-client'

const glean = new Glean({
  apiToken: process.env.GLEAN_CHAT_API_KEY,
  instance: 'your-instance-name'  // e.g., 'scio-prod'
})
```

### Chat Creation

**Method:** `glean.client.chat.create()`

```typescript
const response = await glean.client.chat.create({
  messages: [
    {
      author: 'USER',           // 'USER' or 'GLEAN_AI'
      fragments: [
        {
          text: 'Your message here'
        }
      ]
    }
  ],
  saveChat: false,              // Don't persist chat
  stream: false                 // Blocking response
})
```

**Response:**

```typescript
{
  messages: [
    {
      author: 'GLEAN_AI',
      fragments: [
        {
          text: 'Response text here'
        }
      ]
    }
  ],
  chatId: 'optional-chat-id',
  followUpPrompts: ['suggestion1', 'suggestion2'],
  backendTimeMillis: 1234
}
```

### Message Structure

```typescript
interface ChatMessage {
  author?: "USER" | "GLEAN_AI"
  fragments?: Array<{
    text?: string
    structuredResults?: any[]
    querySuggestion?: any
    file?: any
    action?: any
  }>
  citations?: Array<any>
  messageType?: "CONTENT" | "UPDATE" | "CONTEXT" | "DEBUG" | "ERROR" | "HEADING" | "WARNING"
}
```

### Seer Implementation

See: `src/lib/judge.ts`

```typescript
async function callGleanChat(prompt: string): Promise<string> {
  const response = await glean.client.chat.create({
    messages: [
      {
        author: 'USER',
        fragments: [{ text: prompt }]
      }
    ],
    saveChat: false,
    stream: false
  })

  // Extract all GLEAN_AI message text
  const text = response.messages
    ?.filter(m => m.author === 'GLEAN_AI')
    .flatMap(m => m.fragments || [])
    .map(f => f.text)
    .filter(t => t)
    .join('')

  return text
}
```

---

## Official Documentation

### Glean Agents API
- **Overview:** https://developers.glean.com/api/client-api/agents/overview
- **Create & Wait:** https://developers.glean.com/api/client-api/agents/create-and-wait-run
- **Create & Stream:** https://developers.glean.com/api/client-api/agents/create-and-stream-run
- **Get Schemas:** https://developers.glean.com/api/client-api/agents/get-agent-schemas
- **Search Agents:** https://developers.glean.com/api/client-api/agents/search-agents

### Glean TypeScript SDK
- **GitHub:** https://github.com/gleanwork/api-client-typescript
- **Docs:** https://developers.glean.com/libraries/api-clients/typescript
- **Chat API:** https://developers.glean.com/api/client-api/chat/overview

### Authentication
- **Guide:** https://developers.glean.com/get-started/authentication
- **Scopes:** https://developers.glean.com/api-info/client/authentication/glean-issued#available-scopes

---

## Environment Configuration

`.env` file structure:

```bash
# Glean Agent API (for custom agents built in Glean)
GLEAN_AGENT_API_KEY=your_agent_api_key_here
GLEAN_BACKEND=https://{instance}-be.glean.com

# Glean Chat API (for judge/chat calls using TypeScript SDK)
GLEAN_CHAT_API_KEY=your_chat_api_key_here
GLEAN_INSTANCE=your-instance-name
```

**Example:**
```bash
GLEAN_AGENT_API_KEY=4aJPi3fiDXLipjwdeqA0D4Dh2u7OxaOrQntMvhCprNQ=
GLEAN_BACKEND=https://scio-prod-be.glean.com
GLEAN_CHAT_API_KEY=uc6V68rVpMYB7+dZ/V984zVWJTqFfithSm3ABPmNUVU=
GLEAN_INSTANCE=scio-prod
```

---

## Best Practices

### 1. Always Fetch Agent Schema First

Before running an agent, fetch its schema to determine the correct input format:

```typescript
// ✅ Correct
const schema = await getAgentSchema(agentId)
const hasFormInputs = Object.keys(schema.input_schema).length > 0

if (hasFormInputs) {
  // Use input object
} else {
  // Use messages array
}
```

### 2. Use Correct API Key for Each Call

```typescript
// ✅ Correct
const agentResponse = await fetch('/agents/runs/wait', {
  headers: { 'Authorization': `Bearer ${GLEAN_AGENT_API_KEY}` }
})

const chatResponse = await glean.client.chat.create({...})
// ^ Uses GLEAN_CHAT_API_KEY internally
```

### 3. Handle Both Response Types

Agent responses can vary:

```typescript
// Extract text from GLEAN_AI messages
const text = response.messages
  ?.filter(m => m.author === 'GLEAN_AI' || m.role === 'GLEAN_AI')
  .flatMap(m => m.fragments || m.content || [])
  .map(f => f.text)
  .filter(t => t)
  .join('')
```

### 4. Error Handling

Glean APIs return generic error messages. Always log full responses for debugging:

```typescript
if (!response.ok) {
  const errorText = await response.text()
  console.error('Glean API error:', errorText)
  throw new Error(`${response.status}: ${errorText}`)
}
```

---

## Common Issues

### Issue: 404 Not Found

**Cause:** Wrong endpoint path

**Fix:**
- Agents API: `/rest/api/v1/agents/runs/wait` (not `/api/v1/agents/{id}/run`)
- Chat API: Use SDK, not manual REST calls

### Issue: 400 Bad Request

**Causes:**
1. Using `messages` for form-based agent (should use `input`)
2. Using `input` for chat-based agent (should use `messages`)
3. Missing required form fields
4. Wrong field names in `input` object

**Fix:** Fetch agent schema and use correct format

### Issue: 401 Unauthorized

**Causes:**
1. Wrong API key for the endpoint
2. Expired API key

**Fix:**
- Agent calls: Use `GLEAN_AGENT_API_KEY`
- Chat calls: Use `GLEAN_CHAT_API_KEY`

### Issue: Empty Response / No Text

**Cause:** Extracting from wrong message role or field

**Fix:**
```typescript
// Look for GLEAN_AI messages
const aiMessages = response.messages?.filter(m =>
  m.author === 'GLEAN_AI' || m.role === 'GLEAN_AI'
)
```

---

## Future Enhancements

### Agent Building with TypeScript

The Glean TypeScript SDK doesn't currently support **creating** agents programmatically. For building agents with code, you would need to use the internal agent builder APIs (not publicly documented).

**Reference for future:**
- Agent Builder API (internal): Check Glean admin tools
- Custom agent workflows: May require Glean support access

---

**Last Updated:** 2026-02-12
**Maintained By:** Kenneth Cassel
**Seer Version:** 0.1.0
