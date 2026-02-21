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
    tooltip: 'Decomposes eval guidance into discrete themes and classifies each as COVERED, TOUCHED, or MISSING. Uses: query + eval guidance + response. No search tools — purely reference-based.',
    group: 'coverage',
  },
  response_quality: {
    name: 'Response Quality',
    description: 'Is the output well-structured, concise, and actionable?',
    context: 'Uses: query + response only. No tools. No eval guidance.',
    tooltip: 'Evaluates structure, conciseness, and actionability independent of factual content. Isolated from eval guidance to prevent anchoring bias. Uses: query + response only. No search tools.',
    group: 'quality',
  },
  groundedness: {
    name: 'Groundedness',
    description: 'Are claims supported by the actual content of the retrieved documents?',
    context: 'Uses: query + agent trace + pre-fetched doc content + response. No tools.',
    tooltip: 'Document content is pre-fetched via Glean search API and injected into the prompt. The judge checks whether each claim is supported by the actual content — not just titles. Uses: query + agent trace + pre-fetched document excerpts + response. No search tools needed.',
    group: 'faithfulness',
  },
  hallucination_risk: {
    name: 'Hallucination Risk',
    description: 'Does it assert specific details not found in the source documents?',
    context: 'Uses: query + agent trace + pre-fetched doc content + response. No tools.',
    tooltip: 'Checks for specific unsupported details (names, numbers, dates, metrics) against pre-fetched document content. Rated low/medium/high. Uses: query + agent trace + pre-fetched document excerpts + response. No search tools needed.',
    group: 'faithfulness',
  },
  factual_accuracy: {
    name: 'Factual Accuracy',
    description: 'Are the specific claims actually true according to current company data?',
    context: 'Uses: query + response. Independently searches all company data.',
    tooltip: 'The judge independently searches company data to verify factual claims — names, numbers, dates, metrics — and cites sources. Uses: query + response + company search tools (searches broadly, not scoped to agent\'s sources).',
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
