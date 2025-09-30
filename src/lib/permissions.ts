import { PrismaClient } from '@prisma/client'

export interface Principals {
  teamId: string
  userId: string
  channelId?: string
}

function createFreshPrismaClient() {
  const connectionUrl = process.env.DATABASE_URL
  let pooledUrl: string

  if (process.env.NODE_ENV === 'production') {
    // For Supabase in serverless, use connection pooling parameters
    // Use the same endpoint but add pooler query params
    if (connectionUrl?.includes('supabase.co')) {
      pooledUrl = connectionUrl?.includes('?')
        ? `${connectionUrl}&pgbouncer=true&connection_limit=1`
        : `${connectionUrl}?pgbouncer=true&connection_limit=1`
    } else {
      // Non-Supabase database, use as-is with pooling parameters
      pooledUrl = connectionUrl?.includes('?')
        ? `${connectionUrl}&pgbouncer=true&connection_limit=1`
        : `${connectionUrl}?pgbouncer=true&connection_limit=1`
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

export async function getPermittedDocumentIds(
  principals: Principals
): Promise<string[]> {
  // Create a fresh client for each request in production to avoid prepared statement conflicts
  const client = process.env.NODE_ENV === 'production' ? createFreshPrismaClient() : (await import('./db')).prisma

  try {
    const whereConditions = [
      {
        principalType: 'slack_team',
        principalId: principals.teamId
      },
      {
        principalType: 'slack_team',
        principalId: '*'
      },
      {
        principalType: 'slack_user',
        principalId: principals.userId
      }
    ]

    if (principals.channelId) {
      whereConditions.push({
        principalType: 'slack_channel',
        principalId: principals.channelId
      })
    }

    const permissions = await client.permission.findMany({
      where: {
        OR: whereConditions
      },
      select: {
        documentId: true
      },
      distinct: ['documentId']
    })

    return permissions.map(p => p.documentId)
  } finally {
    // Disconnect fresh client in production
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}

export async function setDocumentPermissions(
  documentId: string,
  permissions: Array<{ principalType: string; principalId: string }>
) {
  const client = process.env.NODE_ENV === 'production' ? createFreshPrismaClient() : (await import('./db')).prisma

  try {
    await client.permission.deleteMany({
      where: { documentId }
    })

    if (permissions.length > 0) {
      await client.permission.createMany({
        data: permissions.map(p => ({
          documentId,
          principalType: p.principalType,
          principalId: p.principalId
        }))
      })
    }
  } finally {
    if (process.env.NODE_ENV === 'production') {
      await client.$disconnect()
    }
  }
}

export function getAllowlistedChannels(): string[] {
  const channelList = process.env.ALLOWLIST_SLACK_CHANNELS || ''
  return channelList.split(',').filter(c => c.trim())
}