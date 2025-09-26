export default function Home() {
  return (
    <main className="min-h-screen p-24">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">AskResearch Status</h1>

        <div className="space-y-4">
          <div className="border rounded p-4">
            <h2 className="text-2xl font-semibold mb-2">System Status</h2>
            <p className="text-green-600">✓ Operational</p>
          </div>

          <div className="border rounded p-4">
            <h2 className="text-2xl font-semibold mb-2">Endpoints</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>/api/slack/command - Slash command handler</li>
              <li>/api/slack/events - Event subscription handler</li>
              <li>/api/ask - Question answering API</li>
              <li>/api/sync/dovetail - Dovetail sync</li>
              <li>/api/sync/slack - Slack sync</li>
            </ul>
          </div>

          <div className="border rounded p-4">
            <h2 className="text-2xl font-semibold mb-2">Configuration</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Model: {process.env.MODEL_NAME || 'gpt-4o-mini'}</li>
              <li>Embedding: {process.env.EMBED_MODEL || 'text-embedding-3-large'}</li>
              <li>Database: {process.env.DATABASE_URL ? 'Connected' : 'Not configured'}</li>
              <li>Redis: {process.env.REDIS_URL ? 'Connected' : 'Not configured'}</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  )
}