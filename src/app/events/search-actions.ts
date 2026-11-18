'use server'

import { auth } from '@/lib/auth/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/db'
import { parseNaturalLanguageQuery } from '@/lib/ai/nl-search'
import { embeddingModel, chatModel } from '@/lib/ai/gateway'

export async function searchEventsNL(query: string) {
  const { data: session } = await auth.getSession()
  const userId = session?.user?.id ?? null

  if (userId) {
    const limited = await enforceRateLimit('nlSearch', userId)
    if (limited) return { ok: false as const, error: limited.error, filters: null }
  }

  const filters = await parseNaturalLanguageQuery(query)

  // Best-effort usage log
  try {
    await prisma.aIUsage.create({
      data: {
        userId: userId ?? undefined,
        feature: 'nl-search',
        model: chatModel(),
      },
    })
  } catch (err) {
    console.error('ai usage log failed', err)
  }

  void embeddingModel
  return { ok: true as const, filters }
}