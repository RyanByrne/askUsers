import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Add connection pooling and prepared statement management
  const connectionUrl = process.env.DATABASE_URL
  const pooledUrl = connectionUrl?.includes('?')
    ? `${connectionUrl}&pgbouncer=true&connection_limit=1&pool_timeout=0&statement_cache_size=0`
    : `${connectionUrl}?pgbouncer=true&connection_limit=1&pool_timeout=0&statement_cache_size=0`

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
    // Insert chunks one by one to avoid SQL construction issues
    for (const chunk of chunks) {
      console.log(`Inserting chunk with ${chunk.embedding.length} dimensions`)

      await client.chunk.upsert({
        where: {
          documentId_ordinal: {
            documentId: chunk.documentId,
            ordinal: chunk.ordinal
          }
        },
        create: {
          documentId: chunk.documentId,
          ordinal: chunk.ordinal,
          text: chunk.text,
          embedding: chunk.embedding,
          meta: chunk.meta || {}
        },
        update: {
          text: chunk.text,
          embedding: chunk.embedding,
          meta: chunk.meta || {}
        }
      })
    }
  } finally {
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}