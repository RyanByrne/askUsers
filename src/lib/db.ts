import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionUrl = process.env.DATABASE_URL
  let pooledUrl: string

  if (process.env.NODE_ENV === 'production') {
    // For Supabase, use session pooling mode (port 5432) instead of transaction mode (6543)
    // Transaction mode doesn't work well with Prisma prepared statements
    if (connectionUrl?.includes('supabase.co')) {
      try {
        const url = new URL(connectionUrl)
        // Properly encode credentials to handle special characters like @ in password
        const encodedUsername = encodeURIComponent(url.username)
        const encodedPassword = encodeURIComponent(url.password)
        // Use session pooler endpoint with same port (5432) but pooler hostname
        pooledUrl = `postgresql://${encodedUsername}:${encodedPassword}@aws-0-us-east-1.pooler.supabase.com:5432${url.pathname}${url.search ? url.search + '&' : '?'}pgbouncer=true&connection_limit=1&statement_cache_size=0`
      } catch (error) {
        console.warn('Failed to parse DATABASE_URL for pooler, using direct connection:', error)
        pooledUrl = connectionUrl || ''
      }
    } else {
      // Non-Supabase database, use as-is with pooling parameters
      pooledUrl = connectionUrl?.includes('?')
        ? `${connectionUrl}&pgbouncer=true&connection_limit=1&statement_cache_size=0`
        : `${connectionUrl}?pgbouncer=true&connection_limit=1&statement_cache_size=0`
    }
  } else {
    // Development - use direct connection
    pooledUrl = connectionUrl || ''
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: pooledUrl,
      },
    },
  })
}

// In production/serverless, create a fresh client each time to avoid prepared statement conflicts
function getPrismaClient() {
  if (process.env.NODE_ENV === 'production') {
    return createPrismaClient()
  }

  if (!globalThis.__prisma) {
    globalThis.__prisma = createPrismaClient()
  }

  return globalThis.__prisma
}

export const prisma = getPrismaClient()

export async function executeRaw<T = unknown>(
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = process.env.NODE_ENV === 'production' ? createPrismaClient() : prisma

  try {
    return await client.$queryRawUnsafe<T[]>(query, ...params)
  } finally {
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}

export async function bulkInsertChunks(
  chunks: Array<{
    documentId: string
    ordinal: number
    text: string
    embedding: number[]
    meta?: Record<string, unknown>
  }>
) {
  if (chunks.length === 0) return

  // Debug logging for embedding dimensions
  chunks.forEach((chunk, i) => {
    console.log(`Chunk ${i}: embedding dimensions = ${chunk.embedding.length}`)
    // Log a sample of the embedding to check for NaN or invalid values
    console.log(`First 5 embedding values:`, chunk.embedding.slice(0, 5))
  })

  const client = process.env.NODE_ENV === 'production' ? createPrismaClient() : prisma

  try {
    // Delete existing chunks for this document first, then insert new ones
    if (chunks.length > 0) {
      const documentId = chunks[0].documentId
      console.log(`Deleting existing chunks for document ${documentId}`)

      await client.$executeRawUnsafe(`
        DELETE FROM "Chunk" WHERE "documentId" = $1
      `, documentId)

      console.log(`Inserting ${chunks.length} new chunks`)

      // Insert chunks using raw SQL to handle vector type properly
      for (const chunk of chunks) {
        console.log(`Inserting chunk ${chunk.ordinal} with ${chunk.embedding.length} dimensions`)

        // Escape single quotes in text and convert embedding to vector format
        const escapedText = chunk.text.replace(/'/g, "''")
        const vectorString = `[${chunk.embedding.join(',')}]`
        const metaString = JSON.stringify(chunk.meta || {}).replace(/'/g, "''")

        await client.$executeRawUnsafe(`
          INSERT INTO "Chunk" (id, "documentId", ordinal, text, embedding, meta)
          VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, $5::jsonb)
        `, chunk.documentId, chunk.ordinal, escapedText, vectorString, metaString)
      }
    }
  } finally {
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}