import { prisma } from '@/db'
import { embedText } from './gateway'
import { addDaysInZone } from '@/lib/time'
import type { EventListParams } from '@/lib/discovery'
import type { Event } from '@/generated/prisma'
import { Prisma } from '@/generated/prisma'

export async function semanticEventSearch(params: EventListParams, page = 1, pageSize = 12) {
  const now = new Date()
  const upper =
    params.when === 'any'
      ? null
      : addDaysInZone(now, params.when === 'today' ? 1 : params.when === 'week' ? 7 : 30)

  // Lexical candidates
  const textWhere: Prisma.EventWhereInput = {
    isPublic: true,
    date: upper ? { gte: now, lt: upper } : { gte: now },
    ...(params.category ? { category: params.category } : {}),
    ...(params.organizer ? { userId: params.organizer } : {}),
  }
  if (params.q) {
    const contains = params.q
    const mode = 'insensitive' as const
    textWhere.OR = [
      { title: { contains, mode } },
      { description: { contains, mode } },
      { location: { contains, mode } },
      { organizerName: { contains, mode } },
    ]
  }
  const textEvents = await prisma.event.findMany({ where: textWhere, take: 200 })

  // Semantic candidates
  let semanticEvents: Event[] = []
  let semanticUnavailable = false
  if (params.q.trim()) {
    try {
      const vec = await embedText(params.q)
      const upperFragment = upper ? Prisma.sql`AND e."date" < ${upper}` : Prisma.sql``
      const categoryFragment = params.category
        ? Prisma.sql`AND e."category" = ${params.category}::"EventCategory"`
        : Prisma.sql``
      const organizerFragment = params.organizer
        ? Prisma.sql`AND e."userId" = ${params.organizer}`
        : Prisma.sql``
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT e."id"
        FROM "Event" e
        WHERE e."isPublic" = true
          AND e."date" >= ${now}
          AND e."embedding" IS NOT NULL
          ${upperFragment}
          ${categoryFragment}
          ${organizerFragment}
        ORDER BY e."embedding" <=> ${JSON.stringify(vec)}::vector
        LIMIT 200
      `
      const ids = rows.map((r) => r.id)
      if (ids.length) {
        const evs = await prisma.event.findMany({ where: { id: { in: ids } } })
        const byId = new Map(evs.map((e) => [e.id, e]))
        semanticEvents = ids.map((id) => byId.get(id)).filter(Boolean) as Event[]
      }
    } catch (err) {
      console.error('semantic event search failed', err)
      semanticUnavailable = true
    }
  }

  // Merge, dedupe, semantic first
  const seen = new Set<string>()
  const merged: Event[] = []
  for (const e of [...semanticEvents, ...textEvents]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    merged.push(e)
  }

  const total = merged.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageClamped = Math.min(Math.max(page, 1), pageCount)
  const start = (pageClamped - 1) * pageSize
  const events = merged.slice(start, start + pageSize)
  return { events, total, page: pageClamped, pageCount, semanticUnavailable }
}