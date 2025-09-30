import { prisma } from './db'

export interface Principals {
  teamId: string
  userId: string
  channelId?: string
}

export async function getPermittedDocumentIds(
  principals: Principals
): Promise<string[]> {
  console.log('[permissions] Checking permissions for principals:', principals)
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

    console.log('[permissions] Querying permissions...')
    const permissions = await prisma.permission.findMany({
      where: {
        OR: whereConditions
      },
      select: {
        documentId: true
      },
      distinct: ['documentId']
    })

    console.log(`[permissions] Found ${permissions.length} documents with access`)
    return permissions.map(p => p.documentId)
  } catch (error) {
    console.error('[permissions] Error getting permitted documents:', error)
    throw error
  }
}

export async function setDocumentPermissions(
  documentId: string,
  permissions: Array<{ principalType: string; principalId: string }>
) {
  await prisma.permission.deleteMany({
    where: { documentId }
  })

  if (permissions.length > 0) {
    await prisma.permission.createMany({
      data: permissions.map(p => ({
        documentId,
        principalType: p.principalType,
        principalId: p.principalId
      }))
    })
  }
}

export function getAllowlistedChannels(): string[] {
  const channelList = process.env.ALLOWLIST_SLACK_CHANNELS || ''
  return channelList.split(',').filter(c => c.trim())
}