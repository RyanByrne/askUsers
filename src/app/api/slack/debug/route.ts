import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const timestamp = request.headers.get('x-slack-request-timestamp')
    const signature = request.headers.get('x-slack-signature')
    const signingSecret = process.env.SLACK_SIGNING_SECRET

    console.log('Debug Info:', {
      hasTimestamp: !!timestamp,
      hasSignature: !!signature,
      hasSigningSecret: !!signingSecret,
      signingSecretLength: signingSecret?.length,
      signingSecretPrefix: signingSecret?.substring(0, 8),
      timestampValue: timestamp,
      signatureValue: signature,
      bodyLength: body.length
    })

    if (!timestamp || !signature || !signingSecret) {
      return NextResponse.json({
        error: 'Missing required headers or config',
        hasTimestamp: !!timestamp,
        hasSignature: !!signature,
        hasSigningSecret: !!signingSecret
      }, { status: 400 })
    }

    // Compute what the signature should be
    const baseString = `v0:${timestamp}:${body}`
    const expectedSignature = 'v0=' + crypto
      .createHmac('sha256', signingSecret)
      .update(baseString)
      .digest('hex')

    const isValid = signature === expectedSignature

    return NextResponse.json({
      valid: isValid,
      receivedSignature: signature,
      expectedSignature: expectedSignature,
      signingSecretPrefix: signingSecret.substring(0, 8) + '...',
      timestampAge: Math.abs(Date.now() / 1000 - parseInt(timestamp)),
      match: signature === expectedSignature
    })
  } catch (error) {
    console.error('Debug endpoint error:', error)
    return NextResponse.json({
      error: 'Debug failed',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}