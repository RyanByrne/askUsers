import { NextRequest, NextResponse } from 'next/server'
import { hybridRetrieval } from '@/lib/retrieval'
import { generateAnswer } from '@/lib/answer'
import { formatSlackAnswer } from '@/lib/slack'

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    console.log('TEST: Starting command processing for:', text)

    const chunks = await hybridRetrieval(
      text,
      {
        teamId: 'test',
        userId: 'test',
        channelId: 'test'
      },
      12
    )

    console.log('TEST: Found', chunks.length, 'chunks')

    if (chunks.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No chunks found'
      })
    }

    const { answer, sources } = await generateAnswer(text, chunks)
    const slackMessage = formatSlackAnswer(answer, sources)

    console.log('TEST: Generated answer successfully')

    return NextResponse.json({
      success: true,
      answer,
      sources,
      chunkCount: chunks.length
    })
  } catch (error) {
    console.error('TEST: Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}