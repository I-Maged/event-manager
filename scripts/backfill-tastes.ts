import 'dotenv/config'
import { prisma } from '../src/db'
import { recomputeUserTaste } from '../src/lib/ai/taste'

async function main() {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT "userId" FROM "RSVP"
  `
  console.log(`Recomputing taste for ${rows.length} users`)
  for (const r of rows) {
    try {
      await recomputeUserTaste(r.userId)
      console.log('taste updated', r.userId)
    } catch (err) {
      console.error('failed', r.userId, err)
    }
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})