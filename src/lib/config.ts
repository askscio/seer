/**
 * Configuration loader for API keys and environment variables
 */

interface Config {
  gleanAgentApiKey: string  // For custom agent execution
  gleanChatApiKey: string   // For chat/judge calls
  gleanBackend: string
  gleanInstance: string
  gleanSessionCookie?: string  // Optional: For internal API trace access (internal employees only)
}

function loadConfig(): Config {
  // Bun automatically loads .env files
  const gleanAgentApiKey = process.env.GLEAN_AGENT_API_KEY
  const gleanChatApiKey = process.env.GLEAN_CHAT_API_KEY
  const gleanBackend = process.env.GLEAN_BACKEND
  const gleanInstance = process.env.GLEAN_INSTANCE
  const gleanSessionCookie = process.env.GLEAN_SESSION_COOKIE

  if (!gleanAgentApiKey) {
    throw new Error('GLEAN_AGENT_API_KEY not found in environment. Copy .env.example to .env and add your keys.')
  }

  if (!gleanChatApiKey) {
    throw new Error('GLEAN_CHAT_API_KEY not found in environment. Copy .env.example to .env and add your keys.')
  }

  if (!gleanBackend) {
    throw new Error('GLEAN_BACKEND not found in environment. Copy .env.example to .env and add your backend URL.')
  }

  if (!gleanInstance) {
    throw new Error('GLEAN_INSTANCE not found in environment. Copy .env.example to .env and add your instance name.')
  }

  return {
    gleanAgentApiKey: gleanAgentApiKey!,
    gleanChatApiKey: gleanChatApiKey!,
    gleanBackend: gleanBackend!,
    gleanInstance: gleanInstance!,
    gleanSessionCookie
  }
}

export const config = loadConfig()
