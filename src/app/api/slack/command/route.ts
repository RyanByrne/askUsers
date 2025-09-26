import { NextRequest, NextResponse } from 'next/server'
import { verifySlackRequest, parseSlackCommand, formatSlackAnswer } from '@/lib/slack'
import { hybridRetrieval } from '@/lib/retrieval'
import { generateAnswer } from '@/lib/answer'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const timestamp = request.headers.get('x-slack-request-timestamp')
  const signature = request.headers.get('x-slack-signature')

  if (!timestamp || !signature || !verifySlackRequest(body, timestamp, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const params = new URLSearchParams(body)
  const command = parseSlackCommand(params)

  setTimeout(async () => {
    try {
      await processCommand(command)
    } catch (error) {
      console.error('Error processing command:', error)
      await sendErrorResponse(command.responseUrl)
    }
  }, 0)

  return NextResponse.json({
    response_type: 'ephemeral',
    text: '🔍 Working on your research question...'
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
  try {
    const chunks = await hybridRetrieval(
      command.text,
      {
        teamId: command.teamId,
        userId: command.userId,
        channelId: command.channelId
      },
      12
    )

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

    const { answer, sources } = await generateAnswer(command.text, chunks)
    const slackMessage = formatSlackAnswer(answer, sources)

    await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        ...slackMessage
      })
    })
  } catch (error) {
    console.error('Error in processCommand:', error)
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