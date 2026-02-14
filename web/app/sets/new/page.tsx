'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ToastContainer'

interface GeneratedCase {
  query: string
  expectedAnswer?: string
  context?: string
}

export default function NewEvalSet() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [generatingAI, setGeneratingAI] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState('')
  const [generatedCases, setGeneratedCases] = useState<GeneratedCase[]>([])
  const [showReview, setShowReview] = useState(false)

  const handleAIGenerate = async (autoCount = 5) => {
    if (!agentId) {
      showToast('Please enter an Agent ID first', 'error')
      return
    }

    setGeneratingAI(true)
    showToast('Generating test cases with AI...', 'loading', 0)

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, count: autoCount }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate eval set')
      }

      const data = await response.json()

      // Pre-fill form with generated data
      if (!name) setName(data.name)
      if (!description) setDescription(data.description)
      setGeneratedCases(data.cases)
      setShowReview(true)
      showToast(`Generated ${data.cases.length} test cases!`, 'success')
    } catch (error) {
      console.error('Error generating eval set:', error)
      showToast('Failed to generate eval set', 'error')
    } finally {
      setGeneratingAI(false)
    }
  }

  // Auto-generate when agent ID is entered (debounced)
  const handleAgentIdChange = async (value: string) => {
    setAgentId(value)

    // Auto-generate if agent ID looks valid (32 chars, alphanumeric)
    if (value.length === 32 && /^[a-f0-9]+$/.test(value)) {
      // Small delay to allow user to finish typing
      setTimeout(() => {
        handleAIGenerate(5)
      }, 500)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Create eval set
      const setResponse = await fetch('/api/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, agentId }),
      })

      if (!setResponse.ok) {
        throw new Error('Failed to create eval set')
      }

      const setData = await setResponse.json()

      // If we have generated cases, add them
      if (generatedCases.length > 0) {
        await Promise.all(
          generatedCases.map((testCase) =>
            fetch('/api/cases', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                evalSetId: setData.id,
                query: testCase.query,
                expectedAnswer: testCase.expectedAnswer,
                context: testCase.context,
              }),
            })
          )
        )
      }

      showToast('Eval set created!', 'success')
      router.push(`/sets/${setData.id}`)
    } catch (error) {
      console.error('Error creating eval set:', error)
      showToast('Failed to create eval set', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Create Eval Set</h1>
        <p className="text-gray-600 mt-1">
          Define a new evaluation set for your agent
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Customer Support Agent Evaluation"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
              placeholder="What does this eval set test?"
              required
            />
          </div>

          {/* Agent ID */}
          <div>
            <label
              htmlFor="agentId"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Agent ID
            </label>
            <input
              type="text"
              id="agentId"
              value={agentId}
              onChange={(e) => handleAgentIdChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="e.g., 3385428f65c54c94a8da40aa0a8243f3"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter agent ID - test cases will auto-generate
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating...' : 'Create Eval Set'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>

        {/* AI Generation */}
        <div className="mt-8 pt-8 border-t border-gray-200">
          <div className="flex items-start gap-3 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
            <div className="text-2xl">✨</div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                AI-Powered Generation
              </h3>
              <p className="text-xs text-gray-600 mb-3">
                Automatically generate test cases using Glean's knowledge base
                and agent schema.
              </p>
              <button
                type="button"
                onClick={handleAIGenerate}
                disabled={!agentId || generatingAI}
                className="px-4 py-2 text-sm bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {generatingAI ? 'Generating...' : '✨ Generate with AI'}
              </button>
            </div>
          </div>

          {/* Generated Cases Preview */}
          {showReview && generatedCases.length > 0 && (
            <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Generated Test Cases ({generatedCases.length})
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {generatedCases.map((testCase, i) => (
                  <div
                    key={i}
                    className="p-3 bg-gray-50 rounded border border-gray-200 text-sm"
                  >
                    <div className="font-medium text-gray-900">
                      {i + 1}. {testCase.query}
                    </div>
                    {testCase.expectedAnswer && (
                      <div className="text-xs text-gray-600 mt-1">
                        Expected: {testCase.expectedAnswer}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                These cases will be added when you create the eval set.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
