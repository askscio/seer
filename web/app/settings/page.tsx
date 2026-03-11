'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Settings {
  gleanApiKey?: string
  gleanBackend?: string
  gleanInstance?: string
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const resp = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (resp.ok) {
        setStatus({ type: 'success', message: 'Settings saved to data/settings.json' })
      } else {
        setStatus({ type: 'error', message: 'Failed to save settings' })
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to save settings' })
    }
    setSaving(false)
  }

  const handleTest = async () => {
    setTesting(true)
    setStatus(null)
    try {
      // Test agent key by fetching agents
      const resp = await fetch(
        `${settings.gleanBackend}/rest/api/v1/agents/search`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.gleanApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: '' }),
        }
      )
      if (resp.ok) {
        setStatus({ type: 'success', message: 'Connection successful! API keys are valid.' })
      } else {
        setStatus({ type: 'error', message: `Connection failed: ${resp.status} ${resp.statusText}` })
      }
    } catch (error) {
      setStatus({ type: 'error', message: `Connection failed: ${error}` })
    }
    setTesting(false)
  }

  const maskKey = (key?: string) => {
    if (!key) return ''
    if (key.length <= 8) return '••••••••'
    return '••••••••' + key.slice(-4)
  }

  const fields = [
    {
      key: 'gleanBackend' as keyof Settings,
      label: 'Backend URL',
      placeholder: 'https://scio-prod-be.glean.com',
      description: 'Your Glean backend endpoint',
      type: 'url',
    },
    {
      key: 'gleanInstance' as keyof Settings,
      label: 'Instance Name',
      placeholder: 'scio-prod',
      description: 'Your Glean instance identifier',
      type: 'text',
    },
    {
      key: 'gleanApiKey' as keyof Settings,
      label: 'API Key',
      placeholder: 'Your Glean API key',
      description: 'Needs chat + search + agents + documents scopes. Create at Glean Settings > API > REST API tokens.',
      type: 'password',
    },
  ]

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-cement mb-2">
        <Link href="/" className="hover:text-[#1A1A1A]">Dashboard</Link>
        <span>/</span>
        <span className="text-[#1A1A1A]">Settings</span>
      </div>

      <h1 className="text-3xl font-bold text-[#1A1A1A] mb-2">Settings</h1>
      <p className="text-cement mb-8">
        Configure API keys for Glean integration. Saved to <code className="bg-gray-100 px-1 rounded">data/settings.json</code> — shared between CLI and web.
      </p>

      <div className="bg-white rounded-lg border border-border shadow-card p-6 max-w-2xl">
        <div className="space-y-6">
          {fields.map(field => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-[#1A1A1A] mb-1">
                {field.label}
              </label>
              <input
                type={field.type === 'password' ? 'text' : field.type}
                value={settings[field.key] || ''}
                onChange={e => setSettings(s => ({ ...s, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue font-mono"
              />
              <p className="mt-1 text-xs text-cement">{field.description}</p>
            </div>
          ))}
        </div>

        {status && (
          <div className={`mt-6 p-3 rounded-lg text-sm ${
            status.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {status.message}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-glean-blue text-white text-sm font-medium rounded-lg hover:bg-glean-blue-hover disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 bg-gray-100 text-[#1A1A1A] text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>
    </div>
  )
}
