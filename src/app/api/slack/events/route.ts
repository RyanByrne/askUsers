import { NextRequest, NextResponse } from 'next/server'
import { verifySlackRequest } from '@/lib/slack'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp')!
  const signature = request.headers.get('x-slack-signature')!

  if (!verifySlackRequest(body, timestamp, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body)

  if (event.type === 'url_verification') {
    return NextResponse.json({ challenge: event.challenge })
  }

  if (event.type === 'event_callback') {
    const eventType = event.event?.type

    switch (eventType) {
      case 'message':
        console.log('Message event received:', event.event)
        break
      case 'app_mention':
        console.log('App mention received:', event.event)
        break
      default:
        console.log('Unhandled event type:', eventType)
    }
  }

  return NextResponse.json({ ok: true })
}