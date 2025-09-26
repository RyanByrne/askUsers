import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function executeRaw<T = unknown>(
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(query, ...params)
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

  const values = chunks
    .map(
      (c) =>
        `(gen_random_uuid(), '${c.documentId}', ${c.ordinal}, '${c.text.replace(/'/g, "''")}', '[${c.embedding.join(',')}]'::vector, '${JSON.stringify(c.meta || {})}'::jsonb)`
    )
    .join(',')

  await prisma.$executeRawUnsafe(`
    INSERT INTO "Chunk" (id, "documentId", ordinal, text, embedding, meta)
    VALUES ${values}
    ON CONFLICT ("documentId", ordinal) DO UPDATE SET
      text = EXCLUDED.text,
      embedding = EXCLUDED.embedding,
      meta = EXCLUDED.meta
  `)
}