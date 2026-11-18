import { prisma } from '@/db'
import { embeddingModel } from './gateway'

function parseVector(text: string | null): number[] | null {
  if (!text) return null
  const m = text.trim().match(/^\[(.*)\]$/)
  if (!m) return null
  const parts = m[1].split(',').map((s) => Number(s.trim()))
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts
}

export async function getUserTaste(userId: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ embedding: string | null }[]>`
    SELECT "embedding"::text AS embedding FROM "UserTaste" WHERE "userId" = ${userId}
  `
  return parseVector(rows[0]?.embedding ?? null)
}

export async function recomputeUserTaste(userId: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ id: string; embedding: string | null; status: string; createdAt: Date }[]>`
    SELECT e."id", e."embedding"::text AS embedding, r."status", r."createdAt"
    FROM "RSVP" r
    JOIN "Event" e ON e."id" = r."eventId"
    WHERE r."userId" = ${userId}
      AND r."status" IN ('GOING','MAYBE')
      AND e."embedding" IS NOT NULL
  `
  if (rows.length === 0) {
    await prisma.$executeRaw`DELETE FROM "UserTaste" WHERE "userId" = ${userId}`
    return null
  }
  const now = Date.now()
  let sum: number[] | null = null
  let weightTotal = 0
  for (const r of rows) {
    const vec = parseVector(r.embedding)
    if (!vec) continue
    const base = r.status === 'GOING' ? 1 : 0.5
    // recency decay: half-life 30 days
    const ageDays = (now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    const recency = Math.exp(-ageDays / 30)
    const w = base * Math.max(0.1, recency)
    if (!sum) sum = new Array(vec.length).fill(0)
    for (let i = 0; i < vec.length; i++) sum[i] += vec[i] * w
    weightTotal += w
  }
  if (!sum || weightTotal === 0) return null
  const avg = sum.map((v) => v / weightTotal)
  const model = embeddingModel()
  const json = JSON.stringify(avg)
  await prisma.$executeRaw`
    INSERT INTO "UserTaste" ("id","userId","embedding","eventCount","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${json}::vector, ${rows.length}, NOW(), NOW())
    ON CONFLICT ("userId") DO UPDATE
      SET "embedding" = ${json}::vector,
          "eventCount" = ${rows.length},
          "updatedAt" = NOW()
  `
  void model
  return avg
}