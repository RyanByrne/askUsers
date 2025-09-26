import { prisma } from '../db'
import { embedBatch } from '../embeddings'
import { bulkInsertChunks } from '../db'

interface DovetailItem {
  id: string
  title: string
  url: string
  author?: string
  createdAt: string
  updatedAt: string
  content: string
  highlights?: string[]
}

export async function fetchDovetailProjectItems(
  projectId: string,
  apiKey: string
): Promise<DovetailItem[]> {
  console.log(`Fetching Dovetail project ${projectId}`)

  return [
    {
      id: 'mock-item-1',
      title: 'User Interview - Agency Owner',
      url: `https://dovetail.com/projects/${projectId}/items/mock-item-1`,
      author: 'Research Team',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: 'Agency owner discussed commission reconciliation challenges...',
      highlights: ['commission tracking is manual', 'need automated reconciliation']
    }
  ]
}

export async function ingestDovetailData(
  mode: 'api' | 'json',
  projectIds?: string[],
  payload?: any
) {
  const items: DovetailItem[] = []

  if (mode === 'api' && projectIds) {
    const apiKey = process.env.DOVETAIL_API_KEY!
    for (const projectId of projectIds) {
      const projectItems = await fetchDovetailProjectItems(projectId, apiKey)
      items.push(...projectItems)
    }
  } else if (mode === 'json' && payload) {
    items.push(...(Array.isArray(payload) ? payload : [payload]))
  }

  for (const item of items) {
    const source = await prisma.source.upsert({
      where: { externalId: `dovetail-${item.id}` },
      create: {
        kind: 'dovetail',
        externalId: `dovetail-${item.id}`,
        name: item.title,
        visibility: { public: true }
      },
      update: {
        name: item.title,
        visibility: { public: true }
      }
    })

    const searchableText = `${item.title} ${item.content} ${(item.highlights || []).join(' ')}`

    const document = await prisma.document.upsert({
      where: { externalId: item.id },
      create: {
        sourceId: source.id,
        externalId: item.id,
        title: item.title,
        url: item.url,
        author: item.author || 'Unknown',
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        searchable: searchableText,
        raw: item as any
      },
      update: {
        title: item.title,
        url: item.url,
        author: item.author || 'Unknown',
        updatedAt: new Date(item.updatedAt),
        searchable: searchableText,
        raw: item as any
      }
    })

    await prisma.permission.upsert({
      where: {
        documentId_principalType_principalId: {
          documentId: document.id,
          principalType: 'slack_team',
          principalId: '*'
        }
      },
      create: {
        documentId: document.id,
        principalType: 'slack_team',
        principalId: '*'
      },
      update: {}
    })

    const chunks = await chunkText(item.content, item.highlights || [])
    const embeddings = await embedBatch(chunks.map(c => c.text))

    await bulkInsertChunks(
      chunks.map((chunk, i) => ({
        documentId: document.id,
        ordinal: i,
        text: chunk.text,
        embedding: embeddings[i],
        meta: { type: chunk.type }
      }))
    )
  }

  await prisma.syncState.upsert({
    where: { sourceId: 'dovetail-global' },
    create: {
      sourceId: 'dovetail-global',
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { itemsProcessed: items.length }
    },
    update: {
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { itemsProcessed: items.length }
    }
  })
}

async function chunkText(
  content: string,
  highlights: string[],
  maxTokens = 1000,
  overlap = 175
): Promise<Array<{ text: string; type: string }>> {
  const chunks: Array<{ text: string; type: string }> = []

  for (const highlight of highlights) {
    chunks.push({ text: highlight, type: 'highlight' })
  }

  const words = content.split(/\s+/)
  const wordsPerChunk = Math.floor(maxTokens * 0.75)
  const overlapWords = Math.floor(overlap * 0.75)

  for (let i = 0; i < words.length; i += wordsPerChunk - overlapWords) {
    const chunk = words.slice(i, i + wordsPerChunk).join(' ')
    if (chunk.length > 50) {
      chunks.push({ text: chunk, type: 'content' })
    }
  }

  return chunks
}