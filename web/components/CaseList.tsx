'use client'

interface EvalCase {
  id: string
  query: string
  evalGuidance: string | null
  context: string | null
  createdAt: Date
}

interface CaseListProps {
  cases: EvalCase[]
}

export default function CaseList({ cases }: CaseListProps) {
  return (
    <div className="space-y-4">
      {cases.map((testCase, index) => (
        <div
          key={testCase.id}
          className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
        >
          <div className="flex justify-between items-start mb-3">
            <span className="text-sm font-semibold text-gray-500">
              Case {index + 1}
            </span>
            <button className="text-sm text-blue-600 hover:text-blue-700">
              Edit
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Query
              </label>
              <p className="text-gray-900 mt-1">{testCase.query}</p>
            </div>

            {testCase.evalGuidance && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Eval Guidance
                </label>
                <p className="text-gray-700 text-sm mt-1">
                  {testCase.evalGuidance}
                </p>
              </div>
            )}

            {testCase.context && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Context
                </label>
                <p className="text-gray-700 text-sm mt-1">{testCase.context}</p>
              </div>
            )}

            <div className="text-xs text-gray-400">
              Added {new Date(testCase.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
