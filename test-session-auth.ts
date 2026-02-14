#!/usr/bin/env bun

/**
 * Integration test: full runAgent() with reasoning chains
 */

import { runAgent } from './src/data/glean'

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 Seer Integration Test (Final)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const result = await runAgent(
    '3385428f65c54c94a8da40aa0a8243f3',
    'Snap Inc.',
    'test-001'
  )

  console.log('\n📊 Result:')
  console.log(`   Latency:  ${result.latencyMs}ms`)
  console.log(`   Trace ID: ${result.traceId || 'N/A'}`)
  console.log(`   Tools:    ${result.toolCalls?.map(t => t.name).join(' → ') || 'none'}`)

  console.log(`\n📝 Response (200 chars):`)
  console.log(`   ${result.response.slice(0, 200)}...`)

  if (result.reasoningChain) {
    console.log(`\n🔗 Reasoning Chain (${result.reasoningChain.length} steps):`)
    for (const step of result.reasoningChain) {
      if (step.type === 'search' && step.queries) {
        console.log(`   🔍 Search: ${step.queries.length} queries`)
        for (const q of step.queries.slice(0, 3)) {
          console.log(`      "${q.slice(0, 80)}"`)
        }
        if (step.queries.length > 3) console.log(`      ... +${step.queries.length - 3} more`)
      }
      if (step.documentsRead) {
        console.log(`   📄 Read ${step.documentsRead.length} documents`)
      }
      if (step.action) {
        console.log(`   ⚡ ${step.action}`)
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ All good — no cookies needed!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
