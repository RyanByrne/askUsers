import { prisma, executeRaw } from './db'
import { embedText, cosineSimilarity } from './embeddings'
import { getPermittedDocumentIds } from './permissions'

interface RetrievedChunk {
  id: string
  documentId: string
  text: string
  embedding: number[]
  title: string
  url: string
  author: string
  updatedAt: Date
  ordinal: number
  score?: number
}

export async function hybridRetrieval(
  query: string,
  principals: { teamId: string; userId: string; channelId?: string },
  limit = 12
): Promise<RetrievedChunk[]> {
  const permittedDocs = await getPermittedDocumentIds(principals)
  if (permittedDocs.length === 0) return []

  const lexicalChunks = await lexicalShortlist(query, permittedDocs, 100)

  if (lexicalChunks.length === 0) return []

  const queryEmbedding = await embedText(query)
  const rerankedChunks = await vectorRerank(lexicalChunks, queryEmbedding)
  const dedupedChunks = mmrDedupe(rerankedChunks, limit)

  return dedupedChunks
}

async function lexicalShortlist(
  query: string,
  permittedDocIds: string[],
  limit: number
): Promise<RetrievedChunk[]> {
  const cleanQuery = query.replace(/'/g, "''")

  const chunks = await executeRaw<RetrievedChunk>(`
    SELECT DISTINCT ON (c.id)
      c.id,
      c."documentId",
      c.text,
      c.embedding::text as embedding,
      c.ordinal,
      d.title,
      d.url,
      d.author,
      d."updatedAt",
      GREATEST(
        similarity(d.searchable, $1),
        CASE WHEN c.text ILIKE $2 THEN 0.8 ELSE 0 END
      ) as lex_score
    FROM "Chunk" c
    INNER JOIN "Document" d ON c."documentId" = d.id
    WHERE
      d.id = ANY($3) AND
      (
        similarity(d.searchable, $1) > 0.1 OR
        c.text ILIKE $2
      )
    ORDER BY c.id, lex_score DESC
    LIMIT $4
  `, [cleanQuery, `%${cleanQuery}%`, permittedDocIds, limit])

  return chunks.map(c => ({
    ...c,
    embedding: parseVector(c.embedding as unknown as string)
  }))
}

async function vectorRerank(
  chunks: RetrievedChunk[],
  queryEmbedding: number[]
): Promise<RetrievedChunk[]> {
  const now = Date.now()

  return chunks.map(chunk => {
    const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding)
    const lexScore = 0.3
    const recencyScore = calculateRecencyScore(chunk.updatedAt, now)

    const finalScore = 0.6 * vectorScore + 0.3 * lexScore + 0.1 * recencyScore

    return { ...chunk, score: finalScore }
  }).sort((a, b) => (b.score || 0) - (a.score || 0))
}

function mmrDedupe(
  chunks: RetrievedChunk[],
  limit: number,
  lambda = 0.5
): RetrievedChunk[] {
  if (chunks.length === 0) return []

  const selected: RetrievedChunk[] = [chunks[0]]
  const remaining = chunks.slice(1)

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const relevance = candidate.score || 0

      let maxSim = 0
      for (const sel of selected) {
        if (sel.documentId === candidate.documentId) {
          maxSim = Math.max(maxSim, 0.9)
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim

      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining[bestIdx])
      remaining.splice(bestIdx, 1)
    } else {
      break
    }
  }

  return selected
}

function calculateRecencyScore(updatedAt: Date, now: number): number {
  const daysAgo = (now - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  return Math.exp(-daysAgo / 30)
}

function parseVector(vectorString: string): number[] {
  return vectorString
    .replace('[', '')
    .replace(']', '')
    .split(',')
    .map(n => parseFloat(n))
}