import { prisma } from '../db'
import { embedBatch } from '../embeddings'
import { bulkInsertChunks } from '../db'

interface DovetailProject {
  id: string
  name: string
  description?: string
  url: string
  created_at: string
  updated_at: string
}

interface DovetailDataItem {
  id: string
  title: string
  description?: string
  url: string
  created_at: string
  updated_at: string
  content?: string
  transcript?: string
  type: 'interview' | 'note' | 'survey' | 'document'
}

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

async function fetchDovetailProjects(apiKey: string): Promise<DovetailProject[]> {
  console.log('Fetching all Dovetail projects')

  const response = await fetch('https://dovetail.com/api/v1/projects', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Dovetail API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.data || data // Handle different response formats
}

async function fetchDovetailProjectData(projectId: string, apiKey: string): Promise<DovetailDataItem[]> {
  console.log(`Fetching data for Dovetail project ${projectId}`)

  const response = await fetch(`https://dovetail.com/api/v1/data?project_id=${projectId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Dovetail API error for project ${projectId}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.data || data
}

async function fetchDovetailDataDetails(dataId: string, apiKey: string): Promise<DovetailDataItem> {
  console.log(`Fetching details for Dovetail data item ${dataId}`)

  const response = await fetch(`https://dovetail.com/api/v1/data/${dataId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Dovetail API error for data ${dataId}: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function fetchDovetailProjectItems(
  projectId: string,
  apiKey: string
): Promise<DovetailItem[]> {
  console.log(`Fetching Dovetail project ${projectId}`)

  try {
    const dataItems = await fetchDovetailProjectData(projectId, apiKey)
    const items: DovetailItem[] = []

    for (const dataItem of dataItems) {
      try {
        // Fetch full details for each data item
        const fullData = await fetchDovetailDataDetails(dataItem.id, apiKey)

        const content = fullData.transcript || fullData.content || fullData.description || ''

        items.push({
          id: fullData.id,
          title: fullData.title,
          url: fullData.url,
          author: 'Research Team', // Dovetail doesn't always provide author info
          createdAt: fullData.created_at,
          updatedAt: fullData.updated_at,
          content: content,
          highlights: [] // We'll extract highlights from notes/insights separately
        })
      } catch (error) {
        console.error(`Error fetching details for data item ${dataItem.id}:`, error)
        // Continue processing other items
      }
    }

    return items
  } catch (error) {
    console.error(`Error fetching project ${projectId}:`, error)
    return []
  }
}

export async function ingestDovetailData(
  mode: 'api' | 'json',
  projectIds?: string[],
  payload?: any
) {
  const items: DovetailItem[] = []

  if (mode === 'api') {
    const apiKey = process.env.DOVETAIL_API_KEY!
    if (!apiKey) {
      throw new Error('DOVETAIL_API_KEY environment variable is required')
    }

    let targetProjectIds = projectIds

    // If no specific project IDs provided or wildcard, fetch all projects
    if (!projectIds || projectIds.includes('*')) {
      console.log('Fetching all Dovetail projects')
      const allProjects = await fetchDovetailProjects(apiKey)
      targetProjectIds = allProjects.map(p => p.id)
      console.log(`Found ${targetProjectIds.length} Dovetail projects`)
    }

    for (const projectId of targetProjectIds) {
      const projectItems = await fetchDovetailProjectItems(projectId, apiKey)
      items.push(...projectItems)
      console.log(`Ingested ${projectItems.length} items from project ${projectId}`)
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