/**
 * Configuration loader for API keys and environment variables
 */

interface Config {
  gleanApiKey: string
  gleanBackend: string
  anthropicApiKey: string
  openaiApiKey: string
}

function loadConfig(): Config {
  // Bun automatically loads .env files
  const gleanApiKey = process.env.GLEAN_API_KEY
  const gleanBackend = process.env.GLEAN_BACKEND
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  const openaiApiKey = process.env.OPENAI_API_KEY

  if (!gleanApiKey) {
    throw new Error('GLEAN_API_KEY not found in environment. Copy .env.example to .env and add your keys.')
  }

  if (!gleanBackend) {
    throw new Error('GLEAN_BACKEND not found in environment. Copy .env.example to .env and add your backend URL.')
  }

  if (!anthropicApiKey) {
    console.warn('Warning: ANTHROPIC_API_KEY not found. Claude judge models will not work.')
  }

  if (!openaiApiKey) {
    console.warn('Warning: OPENAI_API_KEY not found. OpenAI judge models will not work.')
  }

  return {
    gleanApiKey: gleanApiKey!,
    gleanBackend: gleanBackend!,
    anthropicApiKey: anthropicApiKey || '',
    openaiApiKey: openaiApiKey || ''
  }
}

export const config = loadConfig()
