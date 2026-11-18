import { prisma } from '@/db'

export async function semanticCommentSearch(eventId: string, query: string, limit = 10) {
  // ensure query embedding on the fly
  const { embedText } = await import('./gateway')
  const vec = await embedText(query)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "Comment" c
    WHERE c."eventId" = ${eventId}
      AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${JSON.stringify(vec)}::vector
    LIMIT ${limit}
  `
  const ids = rows.map((r) => r.id)
  if (ids.length === 0) return []
  const comments = await prisma.comment.findMany({ where: { id: { in: ids } } })
  const byId = new Map(comments.map((c) => [c.id, c]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}