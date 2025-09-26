import { NextRequest, NextResponse } from 'next/server'
import { ingestDovetailData } from '@/lib/ingest/dovetail'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.SYNC_SECRET}` && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { mode, projectIds, payload } = body

    if (!mode || !['api', 'json'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "api" or "json"' },
        { status: 400 }
      )
    }

    if (mode === 'api' && !projectIds) {
      const defaultIds = process.env.DOVETAIL_PROJECT_IDS?.split(',') || []
      if (defaultIds.length === 0) {
        return NextResponse.json(
          { error: 'No project IDs provided and no defaults configured' },
          { status: 400 }
        )
      }
      await ingestDovetailData('api', defaultIds)
    } else {
      await ingestDovetailData(mode, projectIds, payload)
    }

    return NextResponse.json({
      success: true,
      message: 'Dovetail sync initiated'
    })
  } catch (error) {
    console.error('Error in Dovetail sync:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
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