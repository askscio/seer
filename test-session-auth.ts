#!/usr/bin/env bun

/**
 * Integration test for the fixed Glean agent runner
 * Tests the public API path end-to-end
 */

import { runAgent } from './src/data/glean'

const TEST_AGENT_ID = '3385428f65c54c94a8da40aa0a8243f3'
const TEST_QUERY = 'Snap Inc.'

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 Seer Agent Runner Integration Test')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log(`Agent: ${TEST_AGENT_ID}`)
  console.log(`Query: "${TEST_QUERY}"`)
  console.log()

  try {
    const result = await runAgent(TEST_AGENT_ID, TEST_QUERY, 'test-case-001')

    console.log('\n✅ Agent run successful!')
    console.log(`\n📊 Metrics:`)
    console.log(`   Latency: ${result.latencyMs}ms`)
    console.log(`   Tokens: ${result.totalTokens ?? 'N/A (public API)'}`)
    console.log(`   Tool calls: ${result.toolCalls ? result.toolCalls.length : 'N/A (public API)'}`)

    console.log(`\n📝 Response (first 300 chars):`)
    console.log(`   ${result.response.slice(0, 300)}`)

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Integration test passed!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  } catch (error) {
    console.error('\n❌ Integration test failed:')
    console.error(error)
    process.exit(1)
  }
}

main()
