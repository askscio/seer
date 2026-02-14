/**
 * Configuration loader
 * Priority: data/settings.json → .env → error
 *
 * Uses a single GLEAN_API_KEY with chat + search + agents scopes.
 * Falls back to legacy GLEAN_CHAT_API_KEY / GLEAN_AGENT_API_KEY if present.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface Config {
  gleanApiKey: string     // Unified key (chat + search + agents)
  gleanBackend: string
  gleanInstance: string
}

function getSettingsPath(): string {
  const candidates = [
    join(process.cwd(), 'data', 'settings.json'),
    join(process.cwd(), '..', 'data', 'settings.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return join(process.cwd(), 'data', 'settings.json')
}

function loadFromSettingsFile(): Partial<Config> | null {
  const settingsPath = getSettingsPath()
  if (!existsSync(settingsPath)) return null
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as Partial<Config>
  } catch {
    return null
  }
}

export function saveSettings(settings: Partial<Config>): void {
  const settingsPath = getSettingsPath()
  const dir = join(settingsPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const existing = loadFromSettingsFile() || {}
  writeFileSync(settingsPath, JSON.stringify({ ...existing, ...settings }, null, 2))
}

export function getSettings(): Partial<Config> {
  return loadFromSettingsFile() || {}
}

function loadConfig(): Config {
  const settings = loadFromSettingsFile()

  // Unified key: GLEAN_API_KEY, with legacy fallbacks
  const gleanApiKey = settings?.gleanApiKey
    || process.env.GLEAN_API_KEY
    || process.env.GLEAN_CHAT_API_KEY   // Legacy fallback
    || process.env.GLEAN_AGENT_API_KEY  // Legacy fallback

  const gleanBackend = settings?.gleanBackend || process.env.GLEAN_BACKEND
  const gleanInstance = settings?.gleanInstance || process.env.GLEAN_INSTANCE

  if (!gleanApiKey) {
    throw new Error('GLEAN_API_KEY not configured. Set it in Settings UI or .env file.')
  }
  if (!gleanBackend) {
    throw new Error('GLEAN_BACKEND not configured. Set it in Settings UI or .env file.')
  }
  if (!gleanInstance) {
    throw new Error('GLEAN_INSTANCE not configured. Set it in Settings UI or .env file.')
  }

  return { gleanApiKey, gleanBackend, gleanInstance }
}

export const config = loadConfig()
