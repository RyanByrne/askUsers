import OpenAI from 'openai'
import { Redis } from '@upstash/redis'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null

const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small'
const EMBED_CACHE_TTL = 86400

export async function embedText(text: string): Promise<number[]> {
  if (!openai) {
    throw new Error('OpenAI API key not configured')
  }

  const cacheKey = `embed:${EMBED_MODEL}:${Buffer.from(text).toString('base64').slice(0, 100)}`

  if (redis) {
    const cached = await redis.get<number[]>(cacheKey)
    if (cached) return cached
  }

  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.slice(0, 8000),
    dimensions: 1536, // Explicitly set to match database schema
  })

  const embedding = response.data[0].embedding

  if (redis) {
    await redis.set(cacheKey, embedding, { ex: EMBED_CACHE_TTL })
  }

  return embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results = await Promise.all(
    texts.map(text => embedText(text))
  )
  return results
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}