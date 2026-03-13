'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ToastContainer'
import { Markdown } from '@/components/Markdown'

interface TestCase {
  query: string
  evalGuidance?: string
  simulatorContext?: string   // For multi-turn: who the simulated user is (persona)
  simulatorStrategy?: string  // For multi-turn: how to interact with this agent (behavioral strategy)
  fields?: Record<string, string>  // Structured inputs for multi-field agents
  source: 'generate' | 'csv' | 'manual'
}

type Tab = 'generate' | 'csv' | 'manual'

export default function NewEvalSet() {
  const router = useRouter()
  const { showToast } = useToast()

  // Form state
  const [agentId, setAgentId] = useState('')
  const [agentName, setAgentName] = useState('')
  const [agentDescription, setAgentDescription] = useState('')
  const [agentType, setAgentType] = useState<'workflow' | 'autonomous' | 'unknown'>('unknown')
  const [fetchingAgent, setFetchingAgent] = useState(false)
  const [agentFetched, setAgentFetched] = useState(false)
  const [agentSchemaData, setAgentSchemaData] = useState<any>(null)
  const [showRawSchema, setShowRawSchema] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('generate')

  // Test cases (unified across all tabs)
  const [cases, setCases] = useState<TestCase[]>([])

  // Generate tab state
  const [generateCount, setGenerateCount] = useState(5)
  const [generating, setGenerating] = useState(false)
  const [generatePhase, setGeneratePhase] = useState('')
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0 })

  // CSV tab state
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Manual tab state
  const [manualQuery, setManualQuery] = useState('')
  const [manualGuidance, setManualGuidance] = useState('')
  const [manualSimulatorContext, setManualSimulatorContext] = useState('')

  // Submit state
  const [creating, setCreating] = useState(false)

  // Fetch agent info on valid ID
  const fetchAgent = useCallback(async (id: string) => {
    if (!id || id.length < 8) return

    setFetchingAgent(true)
    try {
      const resp = await fetch(`/api/agents/${id}`)
      if (resp.ok) {
        const data = await resp.json()
        setAgentName(data.name || '')
        setAgentDescription(data.description || '')
        setAgentType(data.agentType || 'unknown')
        setAgentSchemaData(data.schema || null)
        setAgentFetched(true)
        if (!name) setName(data.name || '')
        if (!description) setDescription(data.description ? `Evaluation of ${data.name}` : '')
      } else {
        setAgentFetched(false)
      }
    } catch {
      setAgentFetched(false)
    } finally {
      setFetchingAgent(false)
    }
  }, [name, description])

  const handleAgentIdChange = (value: string) => {
    setAgentId(value)
    setAgentFetched(false)
    setAgentName('')
    setAgentDescription('')
    setAgentType('unknown')
    setAgentSchemaData(null)
    setShowRawSchema(false)

    // Auto-fetch if agent ID looks valid
    if (value.length >= 24 && /^[a-f0-9]+$/i.test(value)) {
      fetchAgent(value)
    }
  }

  // Generate cases via AI (SSE streaming)
  const handleGenerate = async () => {
    if (!agentId) {
      showToast('Enter an Agent ID first', 'error')
      return
    }

    setGenerating(true)
    setGeneratePhase('Reading agent schema...')
    setGenerateProgress({ current: 0, total: generateCount })

    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, count: generateCount, stream: true }),
      })

      if (!resp.ok) throw new Error('Failed to generate')

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || '' // Keep incomplete message in buffer

        for (const line of lines) {
          const dataLine = line.trim()
          if (!dataLine.startsWith('data: ')) continue
          const data = JSON.parse(dataLine.slice(6))

          switch (data.phase) {
            case 'schema':
              setGeneratePhase('Reading agent schema...')
              break
            case 'inputs':
              setGeneratePhase('Finding inputs with Glean...')
              break
            case 'guidance':
              setGeneratePhase(`Generating eval guidance... (${data.current}/${data.total})`)
              setGenerateProgress({ current: data.current - 1, total: data.total })
              break
            case 'simulator':
              setGeneratePhase(`Generating simulator context... (${data.current}/${data.total})`)
              setGenerateProgress({ current: data.current - 1, total: data.total })
              break
            case 'case':
              // Add case to list as it arrives (preserve structured fields for multi-field agents)
              setCases(prev => [...prev, {
                query: data.case.query,
                evalGuidance: data.case.evalGuidance,
                simulatorContext: data.case.simulatorContext,
                simulatorStrategy: data.case.simulatorStrategy,
                fields: Object.keys(data.case.input || {}).length > 1 ? data.case.input : undefined,
                source: 'generate' as const,
              }])
              setGenerateProgress({ current: data.current, total: data.total })
              setGeneratePhase(`Generated ${data.current}/${data.total} cases`)
              break
            case 'complete':
              if (!name && data.name) setName(data.name)
              if (!description && data.description) setDescription(data.description)
              break
            case 'done':
              setGeneratePhase('')
              showToast(data.message, 'success')
              break
            case 'error':
              showToast(data.message, 'error')
              break
          }
        }
      }
    } catch (error) {
      showToast('Failed to generate test cases', 'error')
    } finally {
      setGenerating(false)
      setGeneratePhase('')
    }
  }

  // Parse CSV file
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return

      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length === 0) {
        showToast('CSV file is empty', 'error')
        return
      }

      // Check if first line is a header
      const firstLine = lines[0].toLowerCase()
      const hasHeader = firstLine.includes('query') || firstLine.includes('eval_guidance') || firstLine.includes('guidance')
      const dataLines = hasHeader ? lines.slice(1) : lines

      const parsed: TestCase[] = []
      for (const line of dataLines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Parse CSV: handle quoted fields
        const fields = parseCSVLine(trimmed)
        if (fields.length > 0 && fields[0]) {
          parsed.push({
            query: fields[0],
            evalGuidance: fields[1] || undefined,
            source: 'csv',
          })
        }
      }

      if (parsed.length === 0) {
        showToast('No valid rows found in CSV', 'error')
        return
      }

      setCases(prev => [...prev, ...parsed])
      showToast(`Imported ${parsed.length} cases from CSV`, 'success')

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.readAsText(file)
  }

  // Add manual case
  const handleAddManual = () => {
    if (!manualQuery.trim()) {
      showToast('Query is required', 'error')
      return
    }

    setCases(prev => [...prev, {
      query: manualQuery.trim(),
      evalGuidance: manualGuidance.trim() || undefined,
      simulatorContext: manualSimulatorContext.trim() || undefined,
      source: 'manual',
    }])
    setManualQuery('')
    setManualSimulatorContext('')
    setManualGuidance('')
    showToast('Case added', 'success')
  }

  // Download CSV template
  const downloadTemplate = () => {
    const template = `query,eval_guidance
"What is [Account]'s current TCV and seat count?","Should include the current total contract value, number of seats, and contract tier. Should reference the most recent renewal or amendment if applicable."
"Who are the key stakeholders at [Account]?","Should list primary contacts by role (executive sponsor, day-to-day admin, champion). Should include names, titles, and engagement level if available."
"What were the main topics discussed in our last meeting with [Account]?","Should reference the most recent meeting by date, list key discussion points, any action items or follow-ups agreed upon, and attendees."
"What agents has [Account] built?","Should list agent names, their purpose/use case, creation date or status (active/draft), and which team owns each one."
"How is [Account]'s adoption trending?","Should cover WAU trend (increasing/flat/declining), power user count, agent WAU if applicable, and any notable changes in usage patterns over the past 30 days."
`
    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'eval-set-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Remove a case
  const handleRemoveCase = (index: number) => {
    setCases(prev => prev.filter((_, i) => i !== index))
  }

  // Edit a case
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editQuery, setEditQuery] = useState('')
  const [editGuidance, setEditGuidance] = useState('')

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setEditQuery(cases[index].query)
    setEditGuidance(cases[index].evalGuidance || '')
  }

  const saveEdit = () => {
    if (editingIndex === null) return
    setCases(prev => prev.map((tc, i) =>
      i === editingIndex
        ? { ...tc, query: editQuery, evalGuidance: editGuidance || undefined }
        : tc
    ))
    setEditingIndex(null)
  }

  const cancelEdit = () => {
    setEditingIndex(null)
  }

  // Submit
  const handleSubmit = async () => {
    if (!name.trim() || !agentId.trim()) {
      showToast('Name and Agent ID are required', 'error')
      return
    }
    if (cases.length === 0) {
      showToast('Add at least one test case', 'error')
      return
    }

    setCreating(true)
    try {
      // Create eval set
      const setResp = await fetch('/api/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, agentId, agentSchema: agentSchemaData, agentType }),
      })

      if (!setResp.ok) throw new Error('Failed to create eval set')
      const setData = await setResp.json()

      // Add all cases
      await Promise.all(
        cases.map(tc =>
          fetch('/api/cases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              evalSetId: setData.id,
              query: tc.query,
              evalGuidance: tc.evalGuidance || null,
              fields: tc.fields || null,
              simulatorContext: tc.simulatorContext || null,
              simulatorStrategy: tc.simulatorStrategy || null,
            }),
          })
        )
      )

      showToast('Eval set created!', 'success')
      router.push(`/sets/${setData.id}`)
    } catch {
      showToast('Failed to create eval set', 'error')
    } finally {
      setCreating(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'generate', label: 'Generate' },
    { id: 'csv', label: 'Upload CSV' },
    { id: 'manual', label: 'Manual' },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#1A1A1A]">Create Eval Set</h1>
        <p className="text-cement mt-1">
          Set up an evaluation for your Glean agent
        </p>
      </div>

      <div className="space-y-6">
        {/* Agent ID */}
        <div className="bg-white rounded-lg shadow-card border border-border p-6">
          <label htmlFor="agentId" className="block text-sm font-medium text-[#1A1A1A] mb-2">
            Agent ID
          </label>
          <div className="relative">
            <input
              type="text"
              id="agentId"
              value={agentId}
              onChange={(e) => handleAgentIdChange(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue font-mono text-sm"
              placeholder="e.g., 3385428f65c54c94a8da40aa0a8243f3"
              required
            />
            {fetchingAgent && (
              <span className="absolute right-3 top-2.5 text-xs text-cement">Fetching...</span>
            )}
          </div>
          {agentFetched && agentName && (
            <div className="mt-2 px-3 py-2 bg-glean-blue-light rounded-lg text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[#1A1A1A]">{agentName}</span>
                <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${
                  agentType === 'autonomous'
                    ? 'bg-[#343CED]/10 text-[#343CED]'
                    : 'bg-cement/10 text-cement'
                }`}>
                  {agentType === 'autonomous' ? 'AUTONOMOUS' : 'WORKFLOW'}
                </span>
              </div>
              {agentDescription && (
                <p className="text-cement text-xs mt-0.5">{agentDescription}</p>
              )}
              {agentSchemaData?.input_schema && (
                <div className="mt-2 pt-2 border-t border-glean-blue/10">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-medium text-cement uppercase tracking-wide">Input Schema</p>
                    <button
                      onClick={() => setShowRawSchema(!showRawSchema)}
                      className="text-[10px] text-glean-blue hover:text-glean-blue-hover font-medium transition-colors"
                    >
                      {showRawSchema ? 'Hide JSON' : 'View JSON'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(agentSchemaData.input_schema).map(([field, meta]: [string, any]) => (
                      <span
                        key={field}
                        className="text-xs px-2 py-0.5 rounded-md bg-white/60 border border-glean-blue/15 text-[#1A1A1A] font-mono"
                      >
                        {field}
                        <span className="text-cement ml-1 font-sans text-[10px]">{meta?.type || 'string'}</span>
                      </span>
                    ))}
                  </div>
                  {showRawSchema && (
                    <pre className="mt-2 p-3 bg-[#1A1A1A] text-green-400 text-xs font-mono rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
                      {JSON.stringify(agentSchemaData, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Name & Description */}
        <div className="bg-white rounded-lg shadow-card border border-border p-6 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-[#1A1A1A] mb-2">
              Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue"
              placeholder="e.g., Account Briefing Agent"
              required
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-[#1A1A1A] mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue h-20 resize-none"
              placeholder="What does this eval set test?"
            />
          </div>
        </div>

        {/* How to Build a Test Set */}
        <div className="bg-glean-blue-light rounded-lg border border-glean-blue/20 p-5">
          <h3 className="text-sm font-semibold text-[#1A1A1A] mb-2">
            How to build a test set
          </h3>
          <p className="text-sm text-cement leading-relaxed">
            Glean Agents may produce different answers over time as underlying source data changes.
            Traditional evaluation approaches — where you score against a static "expected answer" — break down
            quickly in this environment, a problem known as{' '}
            <strong className="text-[#1A1A1A]">eval decay</strong> (<a href="https://arxiv.org/abs/2305.14795" target="_blank" rel="noopener" className="text-glean-blue hover:underline">FreshQA</a>,{' '}
            Vu et al. 2023; <a href="https://arxiv.org/abs/2209.13232" target="_blank" rel="noopener" className="text-glean-blue hover:underline">StreamingQA</a>, Liska et al. 2022).
          </p>
          <p className="text-sm text-cement leading-relaxed mt-2">
            Seer addresses this by evaluating <strong className="text-[#1A1A1A]">themes instead of exact answers</strong>.
            Each test case includes <em>eval guidance</em> — a description of what topics a good response should cover,
            not the specific words it should say. Because themes are stable even as facts change, your test sets remain
            valid without constant maintenance.
          </p>
          <p className="text-sm text-cement leading-relaxed mt-2">
            The judge evaluates across multiple dimensions: <strong className="text-[#1A1A1A]">coverage</strong> checks
            themes against your guidance, <strong className="text-[#1A1A1A]">faithfulness</strong> checks claims against
            the agent's own retrieved documents (no guidance needed), and{' '}
            <strong className="text-[#1A1A1A]">factuality</strong> independently verifies claims via live search.
          </p>
          <p className="text-sm text-cement leading-relaxed mt-2">
            We recommend using <strong className="text-[#1A1A1A]">Generate</strong> to create your first test
            cases — it uses Glean's search to find real inputs and ground eval guidance in current company data.
          </p>
          <div className="mt-3 flex justify-end">
            <a
              href="https://docs.google.com/document/d/1heJh_0g9GxAj48bOGELr-OlnTdT6d-41cZ4ICo85mBM/edit?usp=sharing"
              target="_blank"
              rel="noopener"
              className="text-xs text-glean-blue hover:text-glean-blue-hover font-medium transition-colors"
            >
              Read more →
            </a>
          </div>
        </div>

        {/* Test Cases Section */}
        <div className="bg-white rounded-lg shadow-card border border-border">
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Test Cases</h2>
            <p className="text-xs text-cement mt-1">Add test cases using any method below</p>
          </div>

          {/* Tabs */}
          <div className="border-b border-border px-6 flex gap-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-glean-blue'
                    : 'text-cement hover:text-[#1A1A1A]'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-glean-blue" />
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Generate Tab */}
            {activeTab === 'generate' && (
              <div className="space-y-4">
                <p className="text-sm text-cement">
                  Generate test cases using Glean's ADVANCED agent with company tools.
                  Finds real inputs from your CRM and docs, then generates eval guidance.
                </p>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[#1A1A1A] font-medium">Count:</label>
                  <select
                    value={generateCount}
                    onChange={(e) => setGenerateCount(Number(e.target.value))}
                    disabled={generating}
                    className="px-3 py-1.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30 disabled:opacity-50"
                  >
                    <option value={3}>3 cases</option>
                    <option value={5}>5 cases</option>
                    <option value={10}>10 cases</option>
                  </select>
                  <button
                    onClick={handleGenerate}
                    disabled={!agentId || generating}
                    className="px-4 py-1.5 text-sm bg-glean-blue text-white rounded-lg hover:bg-glean-blue-hover disabled:bg-cement-light disabled:cursor-not-allowed transition-colors"
                  >
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                </div>

                {/* Generation Progress */}
                {generating && generatePhase && (
                  <div className="flex items-center gap-3 p-3 bg-surface-page rounded-lg border border-border-subtle">
                    <div className="relative w-5 h-5 shrink-0">
                      <div className="absolute inset-0 border-2 border-border rounded-full" />
                      <div
                        className="absolute inset-0 border-2 border-glean-blue rounded-full animate-spin"
                        style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }}
                      />
                    </div>
                    <span className="text-sm text-[#1A1A1A]">{generatePhase}</span>
                  </div>
                )}
              </div>
            )}

            {/* CSV Tab */}
            {activeTab === 'csv' && (
              <div className="space-y-4">
                <p className="text-sm text-cement">
                  Upload a CSV file with columns: <code className="text-xs bg-surface-page px-1 py-0.5 rounded font-mono">query,eval_guidance</code>.
                  Header row is optional. Eval guidance column is optional.
                </p>
                <div className="flex items-center gap-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    className="block flex-1 text-sm text-cement
                      file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-border
                      file:text-sm file:font-medium file:bg-surface-page file:text-[#1A1A1A]
                      hover:file:bg-glean-oatmeal-dark file:cursor-pointer file:transition-colors"
                  />
                  <button
                    onClick={downloadTemplate}
                    className="text-xs text-glean-blue hover:text-glean-blue-hover font-medium transition-colors whitespace-nowrap"
                  >
                    ↓ Download template
                  </button>
                </div>
              </div>
            )}

            {/* Manual Tab */}
            {activeTab === 'manual' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1A1A1A] mb-1">
                    Query <span className="text-score-fail">*</span>
                  </label>
                  <textarea
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue text-sm"
                    rows={2}
                    placeholder="What should the agent be asked?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1A1A1A] mb-1">
                    Eval Guidance <span className="text-cement text-xs font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={manualGuidance}
                    onChange={(e) => setManualGuidance(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue text-sm"
                    rows={2}
                    placeholder="What themes should the response cover?"
                  />
                </div>
                {agentType === 'autonomous' && (
                  <div>
                    <label className="block text-sm font-medium text-[#1A1A1A] mb-1">
                      Simulator Context <span className="text-cement text-xs font-normal">(for multi-turn)</span>
                    </label>
                    <textarea
                      value={manualSimulatorContext}
                      onChange={(e) => setManualSimulatorContext(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue text-sm"
                      rows={2}
                      placeholder="Who is the simulated user? What context do they have? How should they respond to follow-ups?"
                    />
                  </div>
                )}
                <button
                  onClick={handleAddManual}
                  disabled={!manualQuery.trim()}
                  className="px-4 py-1.5 text-sm bg-glean-blue text-white rounded-lg hover:bg-glean-blue-hover disabled:bg-cement-light disabled:cursor-not-allowed transition-colors"
                >
                  Add Case
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Case Preview */}
        {cases.length > 0 && (
          <div className="bg-white rounded-lg shadow-card border border-border">
            <div className="px-6 py-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-cement uppercase tracking-wide">
                Test Cases ({cases.length})
              </span>
              <button
                onClick={() => setCases([])}
                className="text-xs text-score-fail hover:text-red-700 transition-colors"
              >
                Clear All
              </button>
            </div>
            <div className="divide-y divide-border-subtle max-h-[32rem] overflow-y-auto">
              {cases.map((tc, i) => (
                <div key={i} className="px-6 py-3 group hover:bg-surface-page/50">
                  {editingIndex === i ? (
                    /* Edit mode */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-cement font-mono">Case {i + 1}</span>
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-cement uppercase block mb-1">Query</label>
                        <textarea
                          value={editQuery}
                          onChange={(e) => setEditQuery(e.target.value)}
                          className="w-full px-3 py-2 border border-glean-blue rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                          rows={2}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-cement uppercase block mb-1">Eval Guidance</label>
                        <textarea
                          value={editGuidance}
                          onChange={(e) => setEditGuidance(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                          rows={3}
                          placeholder="What themes should the response cover?"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="px-3 py-1 text-xs bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 text-xs text-cement border border-border rounded-md hover:bg-surface-page transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-cement font-mono mt-0.5 w-6 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1A1A1A] break-words font-medium">{tc.query}</p>
                        {tc.fields && Object.keys(tc.fields).length > 1 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {Object.entries(tc.fields).slice(1).filter(([, v]) => v).map(([k, v]) => (
                              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-page text-cement border border-border-subtle">
                                {k}: {v}
                              </span>
                            ))}
                          </div>
                        )}
                        {tc.evalGuidance && (
                          <div className="mt-1.5">
                            <Markdown content={tc.evalGuidance} className="text-xs text-cement" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-page text-cement border border-border-subtle">
                          {tc.source}
                        </span>
                        <button
                          onClick={() => startEdit(i)}
                          className="text-cement hover:text-glean-blue opacity-0 group-hover:opacity-100 transition-all text-xs px-1"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemoveCase(i)}
                          className="text-cement hover:text-score-fail opacity-0 group-hover:opacity-100 transition-all text-sm px-1"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create Button */}
        <div className="flex gap-4">
          <button
            onClick={handleSubmit}
            disabled={creating || !name.trim() || !agentId.trim() || cases.length === 0}
            className="flex-1 px-4 py-2.5 bg-glean-blue text-white rounded-lg hover:bg-glean-blue-hover disabled:bg-cement-light disabled:cursor-not-allowed transition-colors font-medium"
          >
            {creating ? 'Creating...' : `Create Eval Set (${cases.length} cases)`}
          </button>
          <button
            onClick={() => router.back()}
            className="px-4 py-2.5 border border-border text-cement rounded-lg hover:bg-surface-page transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Parse a single CSV line, handling quoted fields.
 * Handles: field1,field2 and "field, with comma","field2"
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip next quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }

  fields.push(current.trim())
  return fields
}
