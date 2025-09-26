import { WebClient } from '@slack/web-api'
import crypto from 'crypto'

const tokensMap: Map<string, string> = new Map(
  process.env.SLACK_TOKENS_JSON
    ? Object.entries(JSON.parse(process.env.SLACK_TOKENS_JSON))
    : process.env.SLACK_BOT_TOKEN
    ? [['default', process.env.SLACK_BOT_TOKEN]]
    : []
)

export function getSlackClient(teamId?: string): WebClient {
  const token = teamId ? tokensMap.get(teamId) : tokensMap.get('default')
  if (!token) throw new Error(`No Slack token for team ${teamId}`)
  return new WebClient(token)
}

export function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret || !signature) {
    return false
  }

  const baseString = `v0:${timestamp}:${body}`
  const hash = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'utf8'),
      Buffer.from(signature, 'utf8')
    )
  } catch {
    return false
  }
}

export function formatSlackAnswer(
  answer: string,
  sources: Array<{ title: string; url: string; excerpt?: string }>
) {
  const bullets = answer
    .split('\n')
    .filter(line => line.trim())
    .slice(0, 6)
    .map(line => {
      const boldPattern = /\*\*(.*?)\*\*/g
      return `• ${line.replace(boldPattern, '*$1*')}`
    })
    .join('\n')

  const sourceText = sources
    .slice(0, 5)
    .map((s, i) => `${['①','②','③','④','⑤'][i]} <${s.url}|${s.title}>`)
    .join(' ')

  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: bullets
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Sources (${sources.length}):* ${sourceText}`
          }
        ]
      }
    ]
  }
}

export function parseSlackCommand(body: URLSearchParams) {
  return {
    teamId: body.get('team_id')!,
    userId: body.get('user_id')!,
    channelId: body.get('channel_id')!,
    text: body.get('text')!,
    responseUrl: body.get('response_url')!,
    triggerId: body.get('trigger_id')!
  }
}