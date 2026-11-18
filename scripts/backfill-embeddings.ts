import 'dotenv/config'
import { prisma } from '../src/db'
import { embedEventNow, embedCommentNow } from '../src/lib/ai/embeddings'

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

async function main() {
  const events = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Event" WHERE "embedding" IS NULL
  `
  console.log(`Backfilling ${events.length} events`)
  let ok = 0, fail = 0
  for (const e of events) {
    const full = await prisma.event.findUnique({
      where: { id: e.id },
      select: { id: true, title: true, description: true, category: true, location: true, organizerName: true },
    })
    if (!full) continue
    try {
      await withRetry(() => embedEventNow(full))
      ok++
      console.log('embedded event', e.id)
    } catch (err) {
      fail++
      console.error('failed event', e.id, err instanceof Error ? err.message : err)
    }
  }

  const comments = await prisma.$queryRaw<{ id: string; body: string }[]>`
    SELECT "id", "body" FROM "Comment" WHERE "embedding" IS NULL
  `
  console.log(`Backfilling ${comments.length} comments`)
  for (const c of comments) {
    try {
      await withRetry(() => embedCommentNow(c.id, c.body))
      ok++
      console.log('embedded comment', c.id)
    } catch (err) {
      fail++
      console.error('failed comment', c.id, err instanceof Error ? err.message : err)
    }
  }

  console.log(`Done. succeeded=${ok} failed=${fail}`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})