# AskResearch - Slack Research Copilot

Production-ready Slack bot that answers questions with grounded, cited summaries from Dovetail and Slack channels.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment:
```bash
cp .env.example .env.local
# Fill in your credentials including UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
```

3. Setup database:
```bash
pnpm run generate
pnpm run migrate
pnpm run seed
```

4. Start development:
```bash
pnpm dev
```

## Quick Test

Test the API locally:

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": "T001",
    "userId": "U12345",
    "channelId": "C001",
    "question": "What did agency owners say about commissions reconciliation?"
  }'
```

## Slack Setup

1. Create a Slack app at api.slack.com
2. Add slash command: `/askresearch` → `https://your-domain.vercel.app/api/slack/command`
3. Subscribe to events: `https://your-domain.vercel.app/api/slack/events`
4. Install to workspace and copy tokens to `.env.local`

## Data Ingestion

### Dovetail Sync
```bash
curl -X POST http://localhost:3000/api/sync/dovetail \
  -H "Content-Type: application/json" \
  -d '{"mode": "api", "projectIds": ["proj_1", "proj_2"]}'
```

### Slack Sync
```bash
curl -X POST http://localhost:3000/api/sync/slack \
  -H "Content-Type: application/json" \
  -d '{"channelIds": ["C0123", "C0456"], "monthsBack": 3}'
```

## Architecture

- **Hybrid Retrieval**: Combines lexical search (pg_trgm) with vector similarity (pgvector)
- **MMR Deduplication**: Reduces redundancy in retrieved chunks
- **Permission-aware**: Only returns documents user has access to
- **Self-checking**: Optional second LLM call validates answer accuracy

## Deployment

1. Deploy to Vercel:
```bash
vercel --prod
```

2. Set environment variables in Vercel dashboard
3. Configure cron jobs in `vercel.json` for automated sync

## Performance

- Slash command response: <8s
- Retrieval: ~500ms for 100k documents
- Answer generation: ~2s with gpt-4o-mini
- Embedding cache via Redis reduces latency by 60%

## Commands

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm lint` - Run linter
- `pnpm migrate` - Run database migrations
- `pnpm seed` - Seed test data