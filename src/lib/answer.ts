import OpenAI from 'openai'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const MODEL_NAME = process.env.MODEL_NAME || 'gpt-4o-mini'

interface Source {
  title: string
  url: string
  excerpt: string
}

export async function generateAnswer(
  question: string,
  chunks: Array<{
    text: string
    title: string
    url: string
    author?: string
  }>,
  selfCheck = false
): Promise<{ answer: string; sources: Source[] }> {
  const snippets = chunks.map((c, i) => ({
    index: i + 1,
    source: c.title,
    url: c.url,
    excerpt: c.text.slice(0, 500)
  }))

  if (!openai) {
    throw new Error('OpenAI API key not configured')
  }

  const systemPrompt = `You are a research assistant. Only write facts supported by the provided snippets. Cite every key claim with [1], [2], etc. If insufficient evidence, say what's missing. Answer in 120-180 words.`

  const userPrompt = `Question: ${question}

Available snippets:
${snippets.map(s => `[${s.index}] ${s.source}
URL: ${s.url}
Content: ${s.excerpt}`).join('\n\n')}

Write a comprehensive answer using **bold** for key phrases. Cite all claims.`

  const completion = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 300
  })

  let answer = completion.choices[0].message.content || ''

  if (selfCheck && openai) {
    const checkCompletion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: 'Check if any statements lack citations or are unsupported. Return only unsupported claims or "None".' },
        { role: 'user', content: `Answer: ${answer}\n\nSnippets: ${JSON.stringify(snippets)}` }
      ],
      temperature: 0,
      max_tokens: 100
    })

    const issues = checkCompletion.choices[0].message.content || ''
    if (issues !== 'None' && issues.length > 10) {
      answer = answer.replace(/(?:likely|probably|suggests|indicates)/gi, 'may')
    }
  }

  const usedCitations = new Set<number>()
  const citationRegex = /\[(\d+)\]/g
  let match
  while ((match = citationRegex.exec(answer)) !== null) {
    usedCitations.add(parseInt(match[1]))
  }

  const sources = Array.from(usedCitations)
    .filter(i => i > 0 && i <= snippets.length)
    .map(i => ({
      title: snippets[i - 1].source,
      url: snippets[i - 1].url,
      excerpt: snippets[i - 1].excerpt
    }))

  return { answer, sources }
}