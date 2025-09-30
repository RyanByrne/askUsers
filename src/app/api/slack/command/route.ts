import { NextRequest, NextResponse } from 'next/server'
import { verifySlackRequest, parseSlackCommand, formatSlackAnswer } from '@/lib/slack'
import { hybridRetrieval } from '@/lib/retrieval'
import { generateAnswer } from '@/lib/answer'

export async function GET(request: NextRequest) {
  return NextResponse.json({
    error: 'Slack slash commands should use POST method, not GET. Check your Slack app configuration.',
    received_method: 'GET',
    expected_method: 'POST'
  }, { status: 405 })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp')
  const signature = request.headers.get('x-slack-signature')

  if (!timestamp || !signature || !verifySlackRequest(body, timestamp, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const params = new URLSearchParams(body)
  const command = parseSlackCommand(params)

  // Process asynchronously to avoid Slack's 3-second timeout
  processCommand(command).catch((error) => {
    console.error('Error in async processCommand:', error)
  })

  // Return immediate response to Slack
  return NextResponse.json({
    response_type: 'ephemeral',
    text: '🔍 Processing your question...'
  })
}

async function processCommand(command: {
  teamId: string
  userId: string
  channelId: string
  text: string
  responseUrl: string
  triggerId: string
}) {
  console.log('Starting processCommand for:', command.text)
  try {
    console.log('Calling hybridRetrieval...')
    const chunks = await hybridRetrieval(
      command.text,
      {
        teamId: command.teamId,
        userId: command.userId,
        channelId: command.channelId
      },
      12
    )
    console.log('hybridRetrieval returned', chunks.length, 'chunks')

    if (chunks.length === 0) {
      await fetch(command.responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: 'No relevant information found for your question. Try rephrasing or check if you have access to the relevant channels.'
        })
      })
      return
    }

    console.log('Generating answer...')
    const { answer, sources } = await generateAnswer(command.text, chunks)
    const slackMessage = formatSlackAnswer(answer, sources)

    console.log('Posting response to Slack...')
    const response = await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        ...slackMessage
      })
    })
    console.log('processCommand completed successfully, status:', response.status)
  } catch (error) {
    console.error('Error in processCommand:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    // Send fallback response
    await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: 'Sorry, there was an error processing your request. Please try again.'
      })
    })
  }
}

async function sendErrorResponse(responseUrl: string) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      text: 'Sorry, an error occurred while processing your request. Please try again.'
    })
  })
}