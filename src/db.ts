// Next.js loads .env* automatically. Standalone tsx scripts must
// `import 'dotenv/config'` before importing this module.
import { requireEnv } from '@/lib/env'
import { PrismaClient } from './generated/prisma'
import { PrismaNeon } from '@prisma/adapter-neon'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: requireEnv('DATABASE_URL'),
  })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
