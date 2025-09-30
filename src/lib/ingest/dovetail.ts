import { prisma } from '../db'
import { embedBatch } from '../embeddings'
import { bulkInsertChunks } from '../db'

// Rate limiting helper
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function rateLimitedFetch(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options)

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * Math.pow(2, attempt), 10000)

      console.log(`Rate limited. Waiting ${waitTime}ms before retry ${attempt}/${retries}`)
      await sleep(waitTime)
      continue
    }

    if (!response.ok && attempt < retries) {
      console.log(`Request failed (${response.status}). Retrying in ${1000 * attempt}ms...`)
      await sleep(1000 * attempt)
      continue
    }

    return response
  }

  throw new Error('Max retries exceeded')
}

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
  type?: 'interview' | 'note' | 'survey' | 'document'
  deleted?: boolean
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

export async function fetchDovetailProjects(apiKey: string): Promise<DovetailProject[]> {
  console.log('Fetching all Dovetail projects')

  const response = await rateLimitedFetch('https://dovetail.com/api/v1/projects', {
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

async function fetchDovetailProjectNotes(projectId: string, apiKey: string): Promise<DovetailDataItem[]> {
  console.log(`Fetching notes for Dovetail project ${projectId}`)

  let allNotes: DovetailDataItem[] = []
  let cursor: string | null = null
  let hasMore = true
  let pageCount = 0
  const MAX_PAGES = 20 // Safety limit: 20 pages × 100 notes = 2000 notes max

  while (hasMore && pageCount < MAX_PAGES) {
    const url = cursor
      ? `https://dovetail.com/api/v1/notes?project_id=${projectId}&cursor=${cursor}`
      : `https://dovetail.com/api/v1/notes?project_id=${projectId}`

    const response = await rateLimitedFetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Dovetail API error for project ${projectId}: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    const notes = result.data || []

    // Filter notes to only include those from the requested project
    // The API doesn't properly filter by project_id, so we do it client-side
    const filteredNotes = notes.filter((note: any) => {
      const noteProjectId = note.project?.id
      return noteProjectId === projectId
    })

    allNotes = allNotes.concat(filteredNotes)
    pageCount++

    hasMore = result.page?.has_more || false
    cursor = result.page?.next_cursor || null

    console.log(`Page ${pageCount}: Fetched ${notes.length} notes, ${filteredNotes.length} matched project ${projectId} (total matched: ${allNotes.length})`)

    // Stop if we've found enough notes from this project
    if (filteredNotes.length === 0 && allNotes.length > 0) {
      console.log('No more notes from this project found, stopping pagination')
      break
    }

    if (hasMore) {
      await sleep(500) // Rate limiting between pages
    }
  }

  if (pageCount >= MAX_PAGES) {
    console.warn(`Hit page limit of ${MAX_PAGES} pages. Collected ${allNotes.length} notes for project ${projectId}`)
  }

  return allNotes
}

async function fetchNoteHighlights(noteId: string, apiKey: string): Promise<string> {
  console.log(`Fetching highlights for note ${noteId}`)

  let allHighlights: Array<{ text: string }> = []
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const url = cursor
      ? `https://dovetail.com/api/v1/highlights?note_id=${noteId}&cursor=${cursor}`
      : `https://dovetail.com/api/v1/highlights?note_id=${noteId}`

    const response = await rateLimitedFetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.warn(`Could not fetch highlights for note ${noteId}: ${response.status}`)
      return ''
    }

    const result = await response.json()
    const highlights = result.data || []
    allHighlights = allHighlights.concat(highlights)

    hasMore = result.page?.has_more || false
    cursor = result.page?.next_cursor || null

    if (hasMore) {
      await sleep(300) // Rate limiting between pages
    }
  }

  // Combine all highlight texts into a single transcript
  return allHighlights.map(h => h.text).join('\n\n')
}

async function fetchDovetailNoteDetails(noteId: string, apiKey: string): Promise<DovetailDataItem> {
  console.log(`Fetching details for Dovetail note ${noteId}`)

  const response = await rateLimitedFetch(`https://dovetail.com/api/v1/notes/${noteId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Dovetail API error for note ${noteId}: ${response.status} ${response.statusText}`)
  }

  const noteData = await response.json()

  // Fetch highlights (transcript content) for this note
  const transcript = await fetchNoteHighlights(noteId, apiKey)

  // Add transcript to the note data
  return {
    ...noteData.data,
    transcript,
    content: transcript
  }
}

export async function fetchDovetailProjectItems(
  projectId: string,
  apiKey: string
): Promise<DovetailItem[]> {
  console.log(`Fetching Dovetail project ${projectId}`)

  try {
    const notes = await fetchDovetailProjectNotes(projectId, apiKey)
    const items: DovetailItem[] = []

    console.log(`Processing ${notes.length} notes from project ${projectId}`)

    for (const note of notes) {
      try {
        // Skip deleted or invalid notes
        if (!note || note.deleted) {
          console.warn('Skipping null/undefined/deleted note')
          continue
        }

        // Use fallback ID if missing
        const noteId = note.id || `unknown-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

        let fullData
        try {
          // Fetch full details and highlights for each note
          fullData = await fetchDovetailNoteDetails(noteId, apiKey)
        } catch (error) {
          console.warn(`Could not fetch details for ${noteId}, using basic data:`, error instanceof Error ? error.message : String(error))
          // Use the basic note data if we can't fetch details
          fullData = { ...note, transcript: '', content: '' }
        }

        // Don't skip notes without content - they'll be filtered later
        const content = fullData.transcript || fullData.content || fullData.description || ''

        if (content.trim().length > 0) {
          console.log(`Note ${noteId} has ${content.length} characters of content`)
        } else {
          console.warn(`Note ${noteId} has no content`)
        }

        items.push({
          id: fullData.id || noteId,
          title: fullData.title || 'Untitled Note',
          url: fullData.url || `https://dovetail.com/projects/${projectId}/notes/${fullData.id || noteId}`,
          author: (fullData as any).author?.name || 'Research Team',
          createdAt: fullData.created_at || new Date().toISOString(),
          updatedAt: fullData.updated_at || fullData.created_at || new Date().toISOString(),
          content: content,
          highlights: []
        })

        // Add small delay between note requests to avoid rate limiting
        await sleep(500)
      } catch (error) {
        console.error(`Error fetching details for note ${note.id}:`, error)
        // Continue processing other items
      }
    }

    console.log(`Processed ${items.length} items from project ${projectId}`)
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

    let targetProjectIds: string[] = projectIds || []

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

      // Add delay between projects to avoid rate limiting
      if (targetProjectIds.indexOf(projectId) < targetProjectIds.length - 1) {
        await sleep(1000) // 1 second delay between projects
      }
    }
  } else if (mode === 'json' && payload) {
    items.push(...(Array.isArray(payload) ? payload : [payload]))
  }

  for (const item of items) {
    // Only skip completely null items
    if (!item) {
      console.warn('Skipping null item')
      continue
    }

    // Sanitize the item data with robust fallbacks
    const itemId = item.id || `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const itemTitle = item.title || (item as any).name || 'Untitled Research Item'

    console.log(`Processing Dovetail item: ${itemId} - ${itemTitle}`)

    const sanitizedItem = {
      id: String(itemId),
      title: String(itemTitle).substring(0, 500), // Limit title length
      url: item.url || `https://dovetail.com/items/${itemId}`,
      author: item.author || 'Research Team',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
      content: String(item.content || '').substring(0, 50000), // Limit content length
      highlights: item.highlights || []
    }

    const source = await prisma.source.upsert({
      where: { externalId: `dovetail-${sanitizedItem.id}` },
      create: {
        kind: 'dovetail',
        externalId: `dovetail-${sanitizedItem.id}`,
        name: sanitizedItem.title,
        visibility: { public: true }
      },
      update: {
        name: sanitizedItem.title,
        visibility: { public: true }
      }
    })

    const searchableText = `${sanitizedItem.title} ${sanitizedItem.content} ${sanitizedItem.highlights.join(' ')}`

    const document = await prisma.document.upsert({
      where: { externalId: sanitizedItem.id },
      create: {
        sourceId: source.id,
        externalId: sanitizedItem.id,
        title: sanitizedItem.title,
        url: sanitizedItem.url,
        author: sanitizedItem.author,
        createdAt: new Date(sanitizedItem.createdAt),
        updatedAt: new Date(sanitizedItem.updatedAt),
        searchable: searchableText,
        raw: sanitizedItem as any
      },
      update: {
        title: sanitizedItem.title,
        url: sanitizedItem.url,
        author: sanitizedItem.author,
        updatedAt: new Date(sanitizedItem.updatedAt),
        searchable: searchableText,
        raw: sanitizedItem as any
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

    // Only process chunks if there's actual content
    if (sanitizedItem.content && sanitizedItem.content.trim().length > 0) {
      const chunks = await chunkText(sanitizedItem.content, sanitizedItem.highlights)
      if (chunks.length > 0) {
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
    }
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