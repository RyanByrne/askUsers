import { NextRequest, NextResponse } from 'next/server'
import { ingestSlackChannel } from '@/lib/ingest/slack'
import { getAllowlistedChannels } from '@/lib/permissions'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.SYNC_SECRET}` && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { channelIds, monthsBack = 3, teamId } = body

    if (!channelIds || !Array.isArray(channelIds)) {
      return NextResponse.json(
        { error: 'channelIds array is required' },
        { status: 400 }
      )
    }

    const team = teamId || process.env.SLACK_DEFAULT_TEAM_ID || 'T000000'

    const syncPromises = channelIds.map(channelId =>
      ingestSlackChannel(channelId, team, monthsBack)
    )

    await Promise.all(syncPromises)

    return NextResponse.json({
      success: true,
      message: `Synced ${channelIds.length} channels`
    })
  } catch (error) {
    console.error('Error in Slack sync:', error)
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

  const allowlistedChannels = getAllowlistedChannels()
  if (allowlistedChannels.length === 0) {
    return NextResponse.json({
      error: 'No allowlisted channels configured'
    }, { status: 400 })
  }

  const teamId = process.env.SLACK_DEFAULT_TEAM_ID || 'T000000'

  try {
    const syncPromises = allowlistedChannels.map(channelId =>
      ingestSlackChannel(channelId, teamId, 3)
    )

    await Promise.all(syncPromises)

    return NextResponse.json({
      success: true,
      message: `Synced ${allowlistedChannels.length} channels`
    })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    )
  }
}