import { chatComplete } from './gateway'
import { prisma } from '@/db'

const cache = new Map<string, { value: string[]; expires: number }>()
const TTL = 10 * 60 * 1000

export function rerankEnabled() {
  return (process.env.AI_RERANK_ENABLED ?? 'true').toLowerCase() !== 'false'
}

export async function rerankEventIds(userId: string, candidateIds: string[]): Promise<string[]> {
  if (!rerankEnabled() || candidateIds.length === 0) return candidateIds
  const key = `${userId}:${candidateIds.join(',')}`
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expires > now) {
    const set = new Set(candidateIds)
    return cached.value.filter((id) => set.has(id))
  }
  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content:
            'You rerank event ids by relevance to a user. Return ONLY JSON: {"order":["id",...]}. Include only provided ids.',
        },
        {
          role: 'user',
          content: `Candidate ids: ${JSON.stringify(candidateIds)}`,
        },
      ],
      { json: true, temperature: 0 },
    )
    const parsed = JSON.parse(raw) as { order?: unknown }
    const order = Array.isArray(parsed.order) ? parsed.order.filter((x) => typeof x === 'string') as string[] : []
    const set = new Set(candidateIds)
    const filtered = order.filter((id) => set.has(id))
    // append any missing
    for (const id of candidateIds) if (!filtered.includes(id)) filtered.push(id)
    cache.set(key, { value: filtered, expires: now + TTL })
    // best-effort usage log
    try {
      await prisma.aIUsage.create({ data: { userId, feature: 'recommendation-rerank', model: process.env.OPENROUTER_CHAT_MODEL ?? 'openrouter/free' } })
    } catch {}
    return filtered
  } catch {
    return candidateIds
  }
}