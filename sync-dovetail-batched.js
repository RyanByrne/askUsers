#!/usr/bin/env node

// Helper script to sync Dovetail data in batches
// Usage: node sync-dovetail-batched.js <your-deployment-url>

const DEPLOYMENT_URL = process.argv[2]
const SYNC_SECRET = 'sk_sync_abc123def456ghi789jkl012mno345' // Replace with your actual secret
const BATCH_SIZE = 2 // Process 2 projects at a time to stay under timeout

if (!DEPLOYMENT_URL) {
  console.error('Usage: node sync-dovetail-batched.js <your-deployment-url>')
  process.exit(1)
}

async function syncBatch(startIndex = 0) {
  try {
    console.log(`\n🔄 Processing batch starting at index ${startIndex}...`)

    const response = await fetch(`${DEPLOYMENT_URL}/api/sync/dovetail`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mode: 'api',
        batchSize: BATCH_SIZE,
        startIndex: startIndex
      })
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${result.error}`)
    }

    console.log(`✅ ${result.message}`)
    console.log(`📊 Progress: ${result.processedCount}/${result.totalProjects} projects`)

    if (result.processed && result.processed.length > 0) {
      console.log(`📁 Processed projects: ${result.processed.join(', ')}`)
    }

    // If there are more projects, continue with the next batch
    if (result.remainingCount > 0) {
      console.log(`⏳ ${result.remainingCount} projects remaining...`)
      await new Promise(resolve => setTimeout(resolve, 2000)) // 2 second delay between batches
      return await syncBatch(startIndex + BATCH_SIZE)
    } else {
      console.log('\n🎉 All Dovetail projects synced successfully!')
      return result
    }

  } catch (error) {
    console.error('❌ Error syncing batch:', error.message)
    throw error
  }
}

// Start the batched sync
syncBatch()
  .then(() => {
    console.log('\n✨ Dovetail sync completed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Sync failed:', error.message)
    process.exit(1)
  })