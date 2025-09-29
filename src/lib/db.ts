import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // For Supabase in Vercel, use transaction pooling mode
  const connectionUrl = process.env.DATABASE_URL
  let pooledUrl: string

  if (process.env.NODE_ENV === 'production') {
    // Use Supabase transaction pooling URL for Vercel
    pooledUrl = connectionUrl?.replace(
      'db.zkmeikgftzqfwwhsimea.supabase.co:5432',
      'aws-0-us-east-1.pooler.supabase.com:6543'
    ) || connectionUrl || ''

    // Add SSL and pooling parameters for production
    if (!pooledUrl.includes('?')) {
      pooledUrl += '?'
    } else {
      pooledUrl += '&'
    }
    pooledUrl += 'pgbouncer=true&connection_limit=1&statement_cache_size=0&sslmode=require'
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