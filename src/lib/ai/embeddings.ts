import { prisma } from '@/db'
import { embedText, embeddingModel } from './gateway'

export function eventEmbeddingText(event: {
  title: string
  description: string
  category: string
  location: string
  organizerName?: string | null
}) {
  return [
    event.title,
    event.description,
    `Category: ${event.category}`,
    `Location: ${event.location}`,
    event.organizerName ? `Organizer: ${event.organizerName}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function ensureEventEmbedding(eventId: string): Promise<number[] | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, description: true, category: true, location: true, organizerName: true, embeddingModel: true },
  })
  if (!event) return null
  const model = embeddingModel()
  // We can't read the vector back via Prisma (Unsupported), so always (re)generate
  // when model changed or embedding missing. Missing detection: regenerate if model differs.
  if (event.embeddingModel && event.embeddingModel === model) {
    // Already embedded with current model; skip regeneration to save calls.
    // (We cannot verify presence without raw SQL; assume present.)
    return null
  }
  const vec = await embedText(eventEmbeddingText(event))
  await prisma.$executeRaw`
    UPDATE "Event"
    SET "embedding" = ${JSON.stringify(vec)}::vector,
        "embeddedAt" = NOW(),
        "embeddingModel" = ${model}
    WHERE "id" = ${eventId}
  `
  return vec
}

export async function ensureCommentEmbedding(commentId: string, body: string): Promise<number[] | null> {
  const model = embeddingModel()
  const vec = await embedText(body)
  await prisma.$executeRaw`
    UPDATE "Comment"
    SET "embedding" = ${JSON.stringify(vec)}::vector,
        "embeddedAt" = NOW()
    WHERE "id" = ${commentId}
  `
  // model stored implicitly via gateway; no column for comment model
  void model
  return vec
}

export async function embedEventNow(event: {
  id: string
  title: string
  description: string
  category: string
  location: string
  organizerName?: string | null
}) {
  const model = embeddingModel()
  const vec = await embedText(eventEmbeddingText(event))
  await prisma.$executeRaw`
    UPDATE "Event"
    SET "embedding" = ${JSON.stringify(vec)}::vector,
        "embeddedAt" = NOW(),
        "embeddingModel" = ${model}
    WHERE "id" = ${event.id}
  `
  return vec
}

export async function embedCommentNow(commentId: string, body: string) {
  const vec = await embedText(body)
  await prisma.$executeRaw`
    UPDATE "Comment"
    SET "embedding" = ${JSON.stringify(vec)}::vector,
        "embeddedAt" = NOW()
    WHERE "id" = ${commentId}
  `
  return vec
}