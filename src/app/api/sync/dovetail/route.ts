import { NextRequest, NextResponse } from 'next/server'
import { ingestDovetailData } from '@/lib/ingest/dovetail'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.SYNC_SECRET}` && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { mode, projectIds, payload, batchSize = 3, startIndex = 0 } = body

    if (!mode || !['api', 'json'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "api" or "json"' },
        { status: 400 }
      )
    }

    if (mode === 'api') {
      let targetProjectIds = projectIds

      if (!projectIds) {
        const defaultIds = process.env.DOVETAIL_PROJECT_IDS?.split(',') || []
        if (defaultIds.length === 0) {
          return NextResponse.json(
            { error: 'No project IDs provided and no defaults configured' },
            { status: 400 }
          )
        }
        targetProjectIds = defaultIds
      }

      // For wildcard, fetch all projects first
      if (targetProjectIds.includes('*')) {
        const { fetchDovetailProjects } = await import('@/lib/ingest/dovetail')
        const apiKey = process.env.DOVETAIL_API_KEY!
        const allProjects = await fetchDovetailProjects(apiKey)
        targetProjectIds = allProjects.map(p => p.id)
      }

      // Process in batches to avoid timeout
      const batch = targetProjectIds.slice(startIndex, startIndex + batchSize)
      const remainingProjects = targetProjectIds.slice(startIndex + batchSize)

      await ingestDovetailData('api', batch, payload)

      return NextResponse.json({
        success: true,
        message: `Processed batch of ${batch.length} projects`,
        processed: batch,
        totalProjects: targetProjectIds.length,
        processedCount: startIndex + batch.length,
        remainingCount: remainingProjects.length,
        nextBatchUrl: remainingProjects.length > 0
          ? `/api/sync/dovetail?startIndex=${startIndex + batchSize}&batchSize=${batchSize}`
          : null
      })
    } else {
      await ingestDovetailData(mode, projectIds, payload)
      return NextResponse.json({
        success: true,
        message: 'Dovetail sync completed'
      })
    }
  } catch (error) {
    console.error('Error in Dovetail sync:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.SYNC_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const defaultIds = process.env.DOVETAIL_PROJECT_IDS?.split(',') || []
  if (defaultIds.length === 0) {
    return NextResponse.json({
      error: 'No default project IDs configured'
    }, { status: 400 })
  }

  try {
    await ingestDovetailData('api', defaultIds)
    return NextResponse.json({
      success: true,
      message: `Synced ${defaultIds.length} projects`
    })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    )
  }
}