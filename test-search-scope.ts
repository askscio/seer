#!/usr/bin/env bun

/**
 * Test if CHAT-scoped API key can also do search
 */

import { Glean } from '@gleanwork/api-client'
import { config } from './src/lib/config'

async function main() {
  const glean = new Glean({
    apiToken: config.gleanChatApiKey,
    instance: config.gleanInstance,
  })

  console.log('Testing Glean SDK search with CHAT key...\n')

  try {
    const results = await glean.client.search.query({
      query: 'Snap Inc kickoff',
      pageSize: 3,
    })

    console.log(`✅ Search works! Found ${results.results?.length || 0} results:`)
    for (const r of results.results || []) {
      console.log(`   - ${r.title} (${r.document?.datasource})`)
    }
  } catch (error: any) {
    console.log(`❌ Search failed: ${error.message}`)

    // Try with agent key
    console.log('\nTrying with Agent API key...')
    const glean2 = new Glean({
      apiToken: config.gleanAgentApiKey,
      instance: config.gleanInstance,
    })
    try {
      const results = await glean2.client.search.query({
        query: 'Snap Inc kickoff',
        pageSize: 3,
      })
      console.log(`✅ Agent key search works! Found ${results.results?.length || 0} results`)
    } catch (error2: any) {
      console.log(`❌ Agent key search also failed: ${error2.message}`)
    }
  }
}

main().catch(console.error)
