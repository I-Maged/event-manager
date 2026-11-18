import { prisma } from '@/db'
import { getUserTaste } from './taste'
import { rerankEventIds, rerankEnabled } from './rerank'

export interface RecommendedResult {
  events: Awaited<ReturnType<typeof prisma.event.findMany>>
  total: number
}

export async function getRecommendedEvents(opts: {
  userId: string
  page?: number
  pageSize?: number
}): Promise<RecommendedResult> {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 12
  const taste = await getUserTaste(opts.userId)
  if (!taste) return getPopularFallback(page, pageSize)

  const limit = Number(process.env.RECOMMENDATION_CANDIDATE_LIMIT ?? 200)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e."id"
    FROM "Event" e
    WHERE e."isPublic" = true
      AND e."date" >= NOW()
      AND e."embedding" IS NOT NULL
    ORDER BY e."embedding" <=> ${JSON.stringify(taste)}::vector
    LIMIT ${limit}
  `
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return getPopularFallback(page, pageSize)

  const events = await prisma.event.findMany({ where: { id: { in: ids } } })
  const byId = new Map(events.map((e) => [e.id, e]))
  let orderedIds = ids
  if (rerankEnabled()) {
    try {
      orderedIds = await rerankEventIds(opts.userId, ids)
    } catch {
      orderedIds = ids
    }
  }
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof events

  const now = Date.now()
  const orgCount = new Map<string, number>()
  const scored = ordered.map((e, idx) => {
    const sim = 1 - idx / ordered.length
    const daysUntil = (new Date(e.date).getTime() - now) / (1000 * 60 * 60 * 24)
    const recencyBoost = daysUntil <= 7 ? 0.15 : 0
    const c = orgCount.get(e.userId) ?? 0
    orgCount.set(e.userId, c + 1)
    const diversityPenalty = c >= 2 ? 0.3 : 0
    return { e, score: sim + recencyBoost - diversityPenalty }
  })
  scored.sort((a, b) => b.score - a.score)

  const total = scored.length
  const start = (page - 1) * pageSize
  const pageEvents = scored.slice(start, start + pageSize).map((s) => s.e)
  return { events: pageEvents, total }
}

export async function getPopularFallback(page: number, pageSize: number): Promise<RecommendedResult> {
  const where = { isPublic: true, date: { gte: new Date() } }
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { date: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.event.count({ where }),
  ])
  return { events, total }
}