'use client'

import { useState } from 'react'

interface JudgeMethodologyProps {
  criteria: string[]
}

// Full prompt templates for each judge call type
const JUDGE_CALLS = {
  coverage: {
    label: 'Coverage',
    sublabel: 'Reference-based · Call 1',
    description: 'Compares the agent response against eval guidance themes. The judge decomposes guidance into discrete themes and classifies each as COVERED, TOUCHED, or MISSING.',
    inputs: ['Query', 'Eval guidance', 'Agent response'],
    model: 'Opus 4.6 (via modelSetId)',
    tools: 'None',
    criteria: ['topical_coverage', 'response_quality'],
    prompt: `You are an expert evaluator assessing an AI agent's response.

=== {CRITERIA_BLOCK} ===

=== MATERIAL ===

<query>{query}</query>

<eval_guidance>
{evalGuidance}
</eval_guidance>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Extract the key themes from the eval guidance
2. For each theme, classify coverage: COVERED / TOUCHED / MISSING
3. Assign a category for each dimension using the rubric

The eval guidance describes ONE valid answer, not THE only valid answer. Do not penalize different wording or additional correct information. Evaluate information density, not length.

<theme_coverage>
- [theme]: [COVERED/TOUCHED/MISSING]
</theme_coverage>

{score_format}`,
  },
  faithfulness: {
    label: 'Faithfulness',
    sublabel: 'Source-grounded · Call 2',
    description: 'Checks if the response faithfully represents the content of the documents the agent retrieved. The judge uses company search tools to read the actual source documents — not just their titles — and verifies claims against their real content.',
    inputs: ['Query', 'Agent execution trace', 'Source document list', 'Agent response'],
    model: 'ADVANCED (Gemini) + modelSetId',
    tools: 'Company search (reads agent\'s source docs)',
    criteria: ['groundedness', 'hallucination_risk'],
    prompt: `You are evaluating whether an AI agent's response is faithful to what it actually retrieved. You are NOT checking correctness — only whether the response accurately represents the content of the source documents.

=== {CRITERIA_BLOCK} ===

=== MATERIAL ===

<query>{query}</query>

<agent_execution_trace>
{formatted_reasoning_chain}
</agent_execution_trace>

<agent_source_documents>
The agent retrieved these documents during execution. Use your search tools to read their actual content, then check if the response faithfully represents what they say.

{source_document_list}
</agent_source_documents>

<actual_response>
{response}
</actual_response>

=== INSTRUCTIONS ===

1. Use your company search tools to read the actual content of the source documents listed above
2. Identify the key claims in the agent's response
3. For each claim, check whether it is supported by the actual content of the retrieved documents
4. Flag any claims where the response misrepresents, exaggerates, or fabricates details not in the sources
5. Assign categories using the rubrics

A response that says "no data found" when no documents were retrieved is CORRECT behavior.

<claim_check>
- "[claim]": [GROUNDED in <source>/UNGROUNDED/HEDGED/MISREPRESENTED from <source>]
</claim_check>

{score_format}`,
  },
  factuality: {
    label: 'Factuality',
    sublabel: 'Search-verified · Call 3',
    description: 'The judge independently searches company data to verify factual claims. Most expensive call — the judge uses Glean\'s ADVANCED agent with company tools to look up names, numbers, dates, and metrics.',
    inputs: ['Query', 'Agent response', 'Agent\'s retrieved sources'],
    model: 'ADVANCED (Gemini) + modelSetId',
    tools: 'Company search, CRM, knowledge base',
    criteria: ['factual_accuracy'],
    prompt: `You are a factual accuracy evaluator. Use your company search tools to independently verify the claims in this AI agent's response. Cite your sources for each verification.

=== {CRITERION} ===

=== MATERIAL ===

<query>{query}</query>

<agent_sources>
The agent retrieved these documents during execution:
{agent_source_list}
</agent_sources>

<agent_response>
{response}
</agent_response>

=== INSTRUCTIONS ===

1. Extract key factual claims (names, numbers, dates, specifics)
2. Search company data to verify each — also check the agent's own retrieved sources if listed above
3. Classify each claim AND cite your source document/system
4. Assign a category

<claim_verification>
- "[claim]": [VERIFIED/IMPRECISE/UNVERIFIABLE/CONTRADICTED/FABRICATED] (source: [what you found and where])
</claim_verification>

{score_format}`,
  },
}

export default function JudgeMethodology({ criteria }: JudgeMethodologyProps) {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set())

  const toggleCall = (callId: string) => {
    setExpandedCalls(prev => {
      const next = new Set(prev)
      if (next.has(callId)) {
        next.delete(callId)
      } else {
        next.add(callId)
      }
      return next
    })
  }

  // Only show calls that have active criteria in this run
  const activeCalls = Object.entries(JUDGE_CALLS).filter(([, call]) =>
    call.criteria.some(c => criteria.includes(c))
  )

  if (activeCalls.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mt-8">
      <h2 className="text-sm font-semibold text-[#1A1A1A] mb-1">Judge Methodology</h2>
      <p className="text-xs text-cement mb-4">
        Read-only view of the prompt templates used to evaluate each dimension.
        Each call type runs independently — they don't share context.
      </p>

      <div className="space-y-2">
        {activeCalls.map(([callId, call]) => (
          <div key={callId} className="border border-border rounded-md overflow-hidden">
            <button
              onClick={() => toggleCall(callId)}
              className="w-full px-4 py-3 flex items-center justify-between bg-surface-page hover:bg-glean-oatmeal-dark transition-colors text-left"
            >
              <div>
                <span className="text-sm font-medium text-[#1A1A1A]">{call.label}</span>
                <span className="text-xs text-cement ml-2">{call.sublabel}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {call.criteria.filter(c => criteria.includes(c)).map(c => (
                    <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-border-subtle text-cement">
                      {c.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
                <span className="text-cement text-xs">
                  {expandedCalls.has(callId) ? '▲' : '▼'}
                </span>
              </div>
            </button>

            {expandedCalls.has(callId) && (
              <div className="px-4 py-4 border-t border-border space-y-4">
                {/* Description */}
                <p className="text-sm text-cement leading-relaxed">
                  {call.description}
                </p>

                {/* Metadata grid */}
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-medium text-cement uppercase tracking-wide block mb-1">Inputs</span>
                    <ul className="space-y-0.5 text-[#1A1A1A]">
                      {call.inputs.map(input => (
                        <li key={input}>• {input}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="font-medium text-cement uppercase tracking-wide block mb-1">Model</span>
                    <span className="text-[#1A1A1A] font-mono text-[11px]">{call.model}</span>
                  </div>
                  <div>
                    <span className="font-medium text-cement uppercase tracking-wide block mb-1">Tools</span>
                    <span className="text-[#1A1A1A]">{call.tools}</span>
                  </div>
                </div>

                {/* Prompt template */}
                <div>
                  <span className="text-xs font-medium text-cement uppercase tracking-wide block mb-2">
                    Prompt Template
                  </span>
                  <pre className="bg-[#1A1A1A] text-green-400 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-80 overflow-y-auto leading-relaxed">
                    {call.prompt}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
