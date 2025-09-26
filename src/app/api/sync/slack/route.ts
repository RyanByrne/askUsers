import { NextRequest, NextResponse } from 'next/server'
import { ingestSlackChannel, ingestAllSlackChannels } from '@/lib/ingest/slack'
import { getAllowlistedChannels } from '@/lib/permissions'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.SYNC_SECRET}` && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { channelIds, monthsBack = 3, teamId, syncAll = false } = body

    const team = teamId || process.env.SLACK_DEFAULT_TEAM_ID
    if (!team) {
      return NextResponse.json(
        { error: 'teamId is required (set SLACK_DEFAULT_TEAM_ID or provide in request)' },
        { status: 400 }
      )
    }

    if (syncAll) {
      // Sync all channels based on allowlist
      await ingestAllSlackChannels(team, monthsBack)
      return NextResponse.json({
        success: true,
        message: 'Synced all allowed channels'
      })
    } else if (channelIds && Array.isArray(channelIds)) {
      // Sync specific channels
      const syncPromises = channelIds.map(channelId =>
        ingestSlackChannel(channelId, team, monthsBack)
      )

      await Promise.all(syncPromises)

      return NextResponse.json({
        success: true,
        message: `Synced ${channelIds.length} channels`
      })
    } else {
      return NextResponse.json(
        { error: 'Either set syncAll: true or provide channelIds array' },
        { status: 400 }
      )
    }
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

  const teamId = process.env.SLACK_DEFAULT_TEAM_ID
  if (!teamId) {
    return NextResponse.json({
      error: 'SLACK_DEFAULT_TEAM_ID not configured'
    }, { status: 400 })
  }

  try {
    // Use the new ingestAllSlackChannels function for cron jobs
    await ingestAllSlackChannels(teamId, 3)

    return NextResponse.json({
      success: true,
      message: 'Synced all allowed channels'
    })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    )
  }
}