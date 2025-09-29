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
  })

  const client = process.env.NODE_ENV === 'production' ? createPrismaClient() : prisma

  try {
    const values = chunks
      .map(
        (c) =>
          `(gen_random_uuid(), '${c.documentId}', ${c.ordinal}, '${c.text.replace(/'/g, "''")}', '[${c.embedding.join(',')}]'::vector, '${JSON.stringify(c.meta || {})}'::jsonb)`
      )
      .join(',')

    await client.$executeRawUnsafe(`
      INSERT INTO "Chunk" (id, "documentId", ordinal, text, embedding, meta)
      VALUES ${values}
      ON CONFLICT ("documentId", ordinal) DO UPDATE SET
        text = EXCLUDED.text,
        embedding = EXCLUDED.embedding,
        meta = EXCLUDED.meta
    `)
  } finally {
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}