'use server'

import { auth } from '@/lib/auth/server'
import { prisma } from '@/db'
import { semanticCommentSearch } from '@/lib/ai/comment-search'
import { enforceRateLimit } from '@/lib/rate-limit'

export async function searchComments(eventId: string, query: string) {
  const { data: session } = await auth.getSession()
  const userId = session?.user?.id ?? null
  if (userId) {
    const limited = await enforceRateLimit('comment', userId)
    if (limited) return { ok: false as const, error: limited.error, comments: [] }
  }
  const trimmed = query.trim()
  if (!trimmed) return { ok: true as const, comments: [] }
  try {
    const comments = await semanticCommentSearch(eventId, trimmed, 10)
    // log usage
    try {
      await prisma.aIUsage.create({
        data: { userId: userId ?? undefined, feature: 'comment-search', model: process.env.OPENROUTER_EMBEDDING_MODEL ?? 'nvidia/nemotron-3.5-embed-1b:free' },
      })
    } catch {}
    return { ok: true as const, comments: comments.map((c) => ({ id: c.id, body: c.body, authorName: c.authorName, createdAt: c.createdAt })) }
  } catch (err) {
    console.error('comment search failed', err)
    return { ok: false as const, error: 'Search failed.', comments: [] }
  }
}