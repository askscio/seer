#!/usr/bin/env bun

/**
 * Integration test: runAgent() with trace metadata via /rest/api/v1/runworkflow
 */

import { runAgent } from './src/data/glean'

const TEST_AGENT_ID = '3385428f65c54c94a8da40aa0a8243f3'
const TEST_QUERY = 'Snap Inc.'

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 Seer runAgent() Integration Test')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const result = await runAgent(TEST_AGENT_ID, TEST_QUERY, 'test-001')

  console.log('\n📊 Results:')
  console.log(`   Latency:    ${result.latencyMs}ms`)
  console.log(`   Trace ID:   ${result.traceId || 'N/A'}`)
  console.log(`   Tokens:     ${result.totalTokens ?? 'N/A (need getworkflowtrace)'}`)
  console.log(`   Tool calls: ${result.toolCalls?.length ?? 0}`)
  if (result.toolCalls) {
    for (const tc of result.toolCalls) {
      console.log(`     → ${tc.name} (${tc.type})`)
    }
  }
  console.log(`\n📝 Response (300 chars):`)
  console.log(`   ${result.response.slice(0, 300)}...`)

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Integration test passed!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
