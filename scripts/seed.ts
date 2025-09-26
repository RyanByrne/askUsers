import { prisma } from '../src/lib/db'
import { embedText } from '../src/lib/embeddings'
import { bulkInsertChunks } from '../src/lib/db'

async function seed() {
  console.log('Starting seed...')

  const dovetailSource = await prisma.source.upsert({
    where: { externalId: 'dovetail-seed-1' },
    create: {
      kind: 'dovetail',
      externalId: 'dovetail-seed-1',
      name: 'Dovetail Seed Project',
      visibility: { public: true }
    },
    update: {
      name: 'Dovetail Seed Project',
      visibility: { public: true }
    }
  })

  const dovetailDoc = await prisma.document.upsert({
    where: { externalId: 'dovetail-doc-1' },
    create: {
      sourceId: dovetailSource.id,
      externalId: 'dovetail-doc-1',
      title: 'Agency Owner Interview - Commission Reconciliation',
      url: 'https://dovetail.com/projects/seed/items/doc-1',
      author: 'Research Team',
      createdAt: new Date('2024-01-15'),
      updatedAt: new Date('2024-01-16'),
      searchable: 'Agency owner interview commission reconciliation manual process automation needed Excel spreadsheets error-prone time-consuming',
      raw: {
        content: 'Agency owner discussed how commission reconciliation is currently a manual process using Excel spreadsheets. They mentioned it takes 2-3 days per month and is error-prone. They strongly emphasized the need for automated reconciliation with real-time tracking.',
        highlights: [
          'Commission tracking is completely manual',
          'Takes 2-3 days per month for reconciliation',
          'Excel-based process is error-prone',
          'Need automated reconciliation system'
        ]
      } as any
    },
    update: {
      title: 'Agency Owner Interview - Commission Reconciliation',
      updatedAt: new Date('2024-01-16')
    }
  })

  // Add permissions for wildcard and specific teams
  await prisma.permission.upsert({
    where: {
      documentId_principalType_principalId: {
        documentId: dovetailDoc.id,
        principalType: 'slack_team',
        principalId: '*'
      }
    },
    create: {
      documentId: dovetailDoc.id,
      principalType: 'slack_team',
      principalId: '*'
    },
    update: {}
  })

  // Add permission for your specific team
  await prisma.permission.upsert({
    where: {
      documentId_principalType_principalId: {
        documentId: dovetailDoc.id,
        principalType: 'slack_team',
        principalId: 'T045L3H0TFT'
      }
    },
    create: {
      documentId: dovetailDoc.id,
      principalType: 'slack_team',
      principalId: 'T045L3H0TFT'
    },
    update: {}
  })

  const dovetailChunkText = 'Agency owner mentioned that commission reconciliation is their biggest pain point. They spend 2-3 days each month manually reconciling commissions in Excel spreadsheets. The process is error-prone and they have found discrepancies of up to $50,000 in a single month. They urgently need an automated solution.'
  const dovetailEmbedding = await embedText(dovetailChunkText)

  await bulkInsertChunks([{
    documentId: dovetailDoc.id,
    ordinal: 0,
    text: dovetailChunkText,
    embedding: dovetailEmbedding,
    meta: { type: 'interview_highlight' }
  }])

  const slackSource = await prisma.source.upsert({
    where: { externalId: 'slack-T001-C001' },
    create: {
      kind: 'slack',
      externalId: 'slack-T001-C001',
      name: 'Slack #product-feedback',
      visibility: { team: 'T001', channel: 'C001' } as any
    },
    update: {
      name: 'Slack #product-feedback'
    }
  })

  const slackDoc = await prisma.document.upsert({
    where: { externalId: 'slack-C001-1704067200.000100' },
    create: {
      sourceId: slackSource.id,
      externalId: 'slack-C001-1704067200.000100',
      title: 'Discussion about commission features',
      url: 'https://slack.com/archives/C001/p1704067200000100',
      author: 'U12345',
      createdAt: new Date('2024-01-01T12:00:00Z'),
      updatedAt: new Date('2024-01-01T12:00:00Z'),
      searchable: 'commission features automated tracking reconciliation customer feedback product',
      raw: {
        messages: [{
          ts: '1704067200.000100',
          user: 'U12345',
          text: 'Multiple customers have asked about automated commission tracking. Seems like a common request especially from agencies.'
        }]
      } as any
    },
    update: {
      title: 'Discussion about commission features',
      updatedAt: new Date('2024-01-01T12:00:00Z')
    }
  })

  // Add channel permission
  await prisma.permission.upsert({
    where: {
      documentId_principalType_principalId: {
        documentId: slackDoc.id,
        principalType: 'slack_channel',
        principalId: 'C001'
      }
    },
    create: {
      documentId: slackDoc.id,
      principalType: 'slack_channel',
      principalId: 'C001'
    },
    update: {}
  })

  // Add team permission for Slack doc
  await prisma.permission.upsert({
    where: {
      documentId_principalType_principalId: {
        documentId: slackDoc.id,
        principalType: 'slack_team',
        principalId: 'T045L3H0TFT'
      }
    },
    create: {
      documentId: slackDoc.id,
      principalType: 'slack_team',
      principalId: 'T045L3H0TFT'
    },
    update: {}
  })

  const slackChunkText = 'Multiple customers have asked about automated commission tracking. Seems like a common request especially from agencies.'
  const slackEmbedding = await embedText(slackChunkText)

  await bulkInsertChunks([{
    documentId: slackDoc.id,
    ordinal: 0,
    text: slackChunkText,
    embedding: slackEmbedding,
    meta: { user: 'U12345', ts: '1704067200.000100' }
  }])

  await prisma.syncState.upsert({
    where: { sourceId: 'dovetail-global' },
    create: {
      sourceId: 'dovetail-global',
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { documentsSeeded: 1 } as any
    },
    update: {
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { documentsSeeded: 1 } as any
    }
  })

  await prisma.syncState.upsert({
    where: { sourceId: 'slack-C001' },
    create: {
      sourceId: 'slack-C001',
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { documentsSeeded: 1 } as any
    },
    update: {
      cursor: new Date().toISOString(),
      lastRun: new Date(),
      status: 'completed',
      stats: { documentsSeeded: 1 } as any
    }
  })

  console.log('Seed completed!')
  await prisma.$disconnect()
}

seed().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})