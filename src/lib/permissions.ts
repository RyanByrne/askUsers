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
    // For Supabase, use session pooling mode (port 5432) instead of transaction mode (6543)
    // Transaction mode doesn't work well with Prisma prepared statements
    if (connectionUrl?.includes('supabase.co')) {
      try {
        const url = new URL(connectionUrl)
        // Use session pooler endpoint with same port (5432) but pooler hostname
        pooledUrl = `postgresql://${url.username}:${url.password}@aws-0-us-east-1.pooler.supabase.com:5432${url.pathname}${url.search ? url.search + '&' : '?'}pgbouncer=true&connection_limit=1&statement_cache_size=0`
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