import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  return NextResponse.json({
    authHeader: authHeader,
    syncSecret: process.env.SYNC_SECRET ? 'SET' : 'NOT_SET',
    nodeEnv: process.env.NODE_ENV,
    dovetailKey: process.env.DOVETAIL_API_KEY ? 'SET' : 'NOT_SET',
    slackToken: process.env.SLACK_BOT_TOKEN ? 'SET' : 'NOT_SET',
    expectedAuth: process.env.SYNC_SECRET ? `Bearer ${process.env.SYNC_SECRET}` : 'SYNC_SECRET not set',
    authMatch: authHeader === `Bearer ${process.env.SYNC_SECRET}`
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}