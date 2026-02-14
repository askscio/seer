/**
 * Configuration loader
 * Priority: data/settings.json → .env → error
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface Config {
  gleanAgentApiKey: string  // For agent schema fetches
  gleanChatApiKey: string   // For runworkflow (CHAT scope) + judge calls
  gleanBackend: string
  gleanInstance: string
}

// Settings file path (relative to project root)
function getSettingsPath(): string {
  // Walk up from current file to find project root (where data/ lives)
  const candidates = [
    join(process.cwd(), 'data', 'settings.json'),       // CLI runs from project root
    join(process.cwd(), '..', 'data', 'settings.json'),  // Web runs from web/
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // Default to project root
  return join(process.cwd(), 'data', 'settings.json')
}

function loadFromSettingsFile(): Partial<Config> | null {
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) return null

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw) as Partial<Config>
  } catch {
    return null
  }
}

export function saveSettings(settings: Partial<Config>): void {
  const settingsPath = getSettingsPath()
  const dir = join(settingsPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Merge with existing settings
  const existing = loadFromSettingsFile() || {}
  const merged = { ...existing, ...settings }
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2))
}

export function getSettings(): Partial<Config> {
  return loadFromSettingsFile() || {}
}

function loadConfig(): Config {
  // Try settings.json first
  const settings = loadFromSettingsFile()

  // Merge: settings.json takes priority, .env as fallback
  const gleanAgentApiKey = settings?.gleanAgentApiKey || process.env.GLEAN_AGENT_API_KEY
  const gleanChatApiKey = settings?.gleanChatApiKey || process.env.GLEAN_CHAT_API_KEY
  const gleanBackend = settings?.gleanBackend || process.env.GLEAN_BACKEND
  const gleanInstance = settings?.gleanInstance || process.env.GLEAN_INSTANCE

  if (!gleanAgentApiKey) {
    throw new Error('GLEAN_AGENT_API_KEY not configured. Set it in Settings UI or .env file.')
  }
  if (!gleanChatApiKey) {
    throw new Error('GLEAN_CHAT_API_KEY not configured. Set it in Settings UI or .env file.')
  }
  if (!gleanBackend) {
    throw new Error('GLEAN_BACKEND not configured. Set it in Settings UI or .env file.')
  }
  if (!gleanInstance) {
    throw new Error('GLEAN_INSTANCE not configured. Set it in Settings UI or .env file.')
  }

  return {
    gleanAgentApiKey,
    gleanChatApiKey,
    gleanBackend,
    gleanInstance,
  }
}

export const config = loadConfig()
