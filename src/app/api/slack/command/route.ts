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

  // Process synchronously for debugging
  try {
    console.log('Starting command processing for team:', command.teamId)

    // Test immediate response
    await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `Debug: Received "${command.text}" from team ${command.teamId}`
      })
    })

    // Try to process the command
    await processCommand(command)
  } catch (error) {
    console.error('Immediate error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Send error directly to Slack
    try {
      await fetch(command.responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: `Error: ${errorMessage.substring(0, 200)}`
        })
      })
    } catch (fetchError) {
      console.error('Failed to send error to Slack:', fetchError)
    }
  }

  return NextResponse.json({
    response_type: 'ephemeral',
    text: 'Processing...'
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
    console.log('Processing command:', { teamId: command.teamId, userId: command.userId, text: command.text })

    const chunks = await hybridRetrieval(
      command.text,
      {
        teamId: command.teamId,
        userId: command.userId,
        channelId: command.channelId
      },
      12
    )

    console.log('Retrieved chunks:', chunks.length)

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
    console.log('Generated answer, sources count:', sources.length)

    const slackMessage = formatSlackAnswer(answer, sources)

    await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        ...slackMessage
      })
    })
    console.log('Sent response successfully')
  } catch (error) {
    console.error('Error in processCommand:', error)
    await fetch(command.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `Debug: Error occurred - ${error instanceof Error ? error.message : 'Unknown error'}`
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