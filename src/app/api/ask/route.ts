import { NextRequest, NextResponse } from 'next/server'
import { hybridRetrieval } from '@/lib/retrieval'
import { generateAnswer } from '@/lib/answer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { teamId, userId, channelId, question } = body

    if (!teamId || !userId || !question) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    const chunks = await hybridRetrieval(
      question,
      { teamId, userId, channelId },
      12
    )

    if (chunks.length === 0) {
      return NextResponse.json({
        answer: 'No relevant information found for your question.',
        sources: []
      })
    }

    const { answer, sources } = await generateAnswer(question, chunks, true)

    return NextResponse.json({
      answer,
      sources
    })
  } catch (error) {
    console.error('Error in /api/ask:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}