import { prisma } from '../db'
import { embedBatch } from '../embeddings'
import { bulkInsertChunks } from '../db'
import { getSlackClient } from '../slack'

interface SlackMessage {
  ts: string
  user: string
  text: string
  thread_ts?: string
  attachments?: any[]
  blocks?: any[]
}

export async function ingestSlackChannel(
  channelId: string,
  teamId: string,
  monthsBack = 3
): Promise<void> {
  const client = getSlackClient(teamId)
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack)
  const cutoffTs = (cutoffDate.getTime() / 1000).toString()

  const source = await prisma.source.upsert({
    where: { externalId: `slack-${teamId}-${channelId}` },
    create: {
      kind: 'slack',
      externalId: `slack-${teamId}-${channelId}`,
      name: `Slack Channel ${channelId}`,
      visibility: { team: teamId, channel: channelId }
    },
    update: {
      name: `Slack Channel ${channelId}`,
      visibility: { team: teamId, channel: channelId }
    }
  })

  let cursor: string | undefined
  let allMessages: SlackMessage[] = []

  while (true) {
    const result = await client.conversations.history({
      channel: channelId,
      oldest: cutoffTs,
      limit: 200,
      cursor
    })

    const messages = (result.messages || []) as SlackMessage[]
    allMessages.push(...messages)

    if (!result.has_more || !result.response_metadata?.next_cursor) break
    cursor = result.response_metadata.next_cursor
  }

  const messageGroups = groupMessagesByThread(allMessages)

  for (const group of messageGroups) {
    const mainMessage = group[0]
    const permalink = await getPermalink(client, channelId, mainMessage.ts)

    const combinedText = group
      .map(m => `${m.user}: ${m.text}`)
      .join('\n')

    const document = await prisma.document.upsert({
      where: { externalId: `slack-${channelId}-${mainMessage.ts}` },
      create: {
        sourceId: source.id,
        externalId: `slack-${channelId}-${mainMessage.ts}`,
        title: mainMessage.text.slice(0, 100) + (mainMessage.text.length > 100 ? '...' : ''),
        url: permalink,
        author: mainMessage.user,
        createdAt: new Date(parseFloat(mainMessage.ts) * 1000),
        updatedAt: new Date(parseFloat(mainMessage.ts) * 1000),
        searchable: combinedText,
        raw: { messages: group } as any
      },
      update: {
        title: mainMessage.text.slice(0, 100) + (mainMessage.text.length > 100 ? '...' : ''),
        url: permalink,
        searchable: combinedText,
        raw: { messages: group } as any
      }
    })

    await prisma.permission.upsert({
      where: {
        documentId_principalType_principalId: {
          documentId: document.id,
          principalType: 'slack_channel',
          principalId: channelId
        }
      },
      create: {
        documentId: document.id,
        principalType: 'slack_channel',
        principalId: channelId
      },
      update: {}
    })

    const chunks = await chunkSlackMessages(group)
    if (chunks.length > 0) {
      const embeddings = await embedBatch(chunks.map(c => c.text))

      await bulkInsertChunks(
        chunks.map((chunk, i) => ({
          documentId: document.id,
          ordinal: i,
          text: chunk.text,
          embedding: embeddings[i],
          meta: { user: chunk.user, ts: chunk.ts }
        }))
      )
    }
  }

  await prisma.syncState.upsert({
    where: { sourceId: `slack-${channelId}` },
    create: {
      sourceId: `slack-${channelId}`,
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { messagesProcessed: allMessages.length }
    },
    update: {
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { messagesProcessed: allMessages.length }
    }
  })
}

function groupMessagesByThread(messages: SlackMessage[]): SlackMessage[][] {
  const threads = new Map<string, SlackMessage[]>()

  for (const msg of messages) {
    const threadKey = msg.thread_ts || msg.ts
    if (!threads.has(threadKey)) {
      threads.set(threadKey, [])
    }
    threads.get(threadKey)!.push(msg)
  }

  return Array.from(threads.values())
}

async function getPermalink(
  client: any,
  channel: string,
  messageTs: string
): Promise<string> {
  try {
    const result = await client.chat.getPermalink({
      channel,
      message_ts: messageTs
    })
    return result.permalink
  } catch {
    return `https://slack.com/archives/${channel}/p${messageTs.replace('.', '')}`
  }
}

async function chunkSlackMessages(
  messages: SlackMessage[]
): Promise<Array<{ text: string; user: string; ts: string }>> {
  const chunks: Array<{ text: string; user: string; ts: string }> = []

  for (const msg of messages) {
    if (msg.text && msg.text.length > 50) {
      const text = msg.text.slice(0, 1200)
      chunks.push({
        text,
        user: msg.user,
        ts: msg.ts
      })
    }
  }

  return chunks
}