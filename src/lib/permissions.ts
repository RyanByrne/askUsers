import { prisma } from './db'

export interface Principals {
  teamId: string
  userId: string
  channelId?: string
}

export async function getPermittedDocumentIds(
  principals: Principals
): Promise<string[]> {
  const conditions = [
    `("principalType" = 'slack_team' AND "principalId" = $1)`,
    `("principalType" = 'slack_team' AND "principalId" = '*')`,
    `("principalType" = 'slack_user' AND "principalId" = $2)`
  ]
  const params = [principals.teamId, principals.userId]

  if (principals.channelId) {
    conditions.push(`("principalType" = 'slack_channel' AND "principalId" = $3)`)
    params.push(principals.channelId)
  }

  const result = await prisma.$queryRawUnsafe<{ documentId: string }[]>(`
    SELECT DISTINCT "documentId"::text
    FROM "Permission"
    WHERE ${conditions.join(' OR ')}
  `, ...params)

  return result.map(r => r.documentId)
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