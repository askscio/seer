/**
 * Shared dimension definitions used across the UI.
 * Single source of truth for tooltips, descriptions, and context info.
 */

export interface DimensionInfo {
  name: string
  description: string
  context: string  // What inputs/tools the judge uses
  tooltip: string  // Full tooltip text combining description + context
  group: 'coverage' | 'quality' | 'faithfulness' | 'factuality' | 'metric'
}

export const DIMENSIONS: Record<string, DimensionInfo> = {
  topical_coverage: {
    name: 'Topical Coverage',
    description: 'Does the response address the expected themes from the eval guidance?',
    context: 'Uses: query + eval guidance + response. No tools.',
    tooltip: 'Decomposes eval guidance into discrete themes, classifying each as COVERED, TOUCHED, or MISSING. Scale: full (all themes covered, actionable alone) → substantial (75%+ covered) → partial (half covered) → minimal (touches topic, little depth) → failure (wrong topic or refusal). No search tools — purely reference-based.',
    group: 'coverage',
  },
  response_quality: {
    name: 'Response Quality',
    description: 'Is the output well-structured, concise, and actionable?',
    context: 'Uses: query + response only. No tools. No eval guidance.',
    tooltip: 'Evaluates structure, conciseness, and actionability independent of factual content. Isolated from eval guidance to prevent anchoring bias (the judge doesn\'t know what the "right" answer is). Scale: full (clear, concise, actionable) → substantial (good, minor issues) → partial (understandable but poorly organized) → minimal (hard to parse) → failure (unusable).',
    group: 'quality',
  },
  groundedness: {
    name: 'Groundedness',
    description: 'Are claims supported by the actual content of the retrieved documents?',
    context: 'Uses: query + full document content (fetched by URL) + response. No tools.',
    tooltip: 'Full document content is fetched via Glean\'s getdocuments API using the URLs from the agent\'s trace — the judge sees everything the agent read, with no truncation. Scale: full (all claims traceable) → substantial (most supported) → partial (mixed) → minimal (mostly ungrounded) → failure (disconnected from sources).',
    group: 'faithfulness',
  },
  hallucination_risk: {
    name: 'Hallucination Risk',
    description: 'Does it assert specific details not found in the source documents?',
    context: 'Uses: query + full document content (fetched by URL) + response. No tools.',
    tooltip: 'Checks for specific unsupported details (names, numbers, dates, metrics) against the full content of documents the agent retrieved. Scale: low (all claims backed or appropriately hedged) → medium (some unsupported but core is grounded) → high (multiple fabricated specifics asserted confidently).',
    group: 'faithfulness',
  },
  factual_accuracy: {
    name: 'Factual Accuracy',
    description: 'Are the specific claims actually true according to current company data?',
    context: 'Uses: query + response + agentic search (ADVANCED agent with company tools).',
    tooltip: 'An independent ADVANCED agent iteratively searches company data to verify each factual claim — names, numbers, dates, metrics — classifying each as VERIFIED, IMPRECISE, UNVERIFIABLE, CONTRADICTED, or FABRICATED, with source citations. Scale: full (all verified) → substantial (majority verified, zero contradicted) → partial (mixed) → minimal (contradictions found) → failure (core claims wrong). Deep mode only.',
    group: 'factuality',
  },
  latency: {
    name: 'Latency',
    description: 'End-to-end response time in milliseconds.',
    context: 'Direct measurement. No judge call.',
    tooltip: 'Measures the total time from sending the query to receiving the complete response. Direct measurement — no judge call needed.',
    group: 'metric',
  },
  tool_call_count: {
    name: 'Tool Calls',
    description: 'Number of tools the agent invoked during execution.',
    context: 'Direct measurement. No judge call.',
    tooltip: 'Counts the number of tool invocations (search, read, think, etc.) during agent execution. Direct measurement — no judge call needed.',
    group: 'metric',
  },
}
