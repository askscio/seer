/**
 * Configuration loader for API keys and environment variables
 */

interface Config {
  gleanApiKey: string
  gleanBackend: string
}

function loadConfig(): Config {
  // Bun automatically loads .env files
  const gleanApiKey = process.env.GLEAN_API_KEY
  const gleanBackend = process.env.GLEAN_BACKEND

  if (!gleanApiKey) {
    throw new Error('GLEAN_API_KEY not found in environment. Copy .env.example to .env and add your keys.')
  }

  if (!gleanBackend) {
    throw new Error('GLEAN_BACKEND not found in environment. Copy .env.example to .env and add your backend URL.')
  }

  return {
    gleanApiKey: gleanApiKey!,
    gleanBackend: gleanBackend!
  }
}

export const config = loadConfig()
