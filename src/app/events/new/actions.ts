'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import {
  parseEventForm,
  type CopilotSuggestion,
  type DraftDescriptionInput,
} from '@/lib/event-validation';
import { resolveOrganizerName, capacityHint } from '@/lib/events';
import { draftDescription } from '@/lib/ai/event-copilot';
import { chatModel } from '@/lib/ai/gateway';
import { enforceRateLimit } from '@/lib/rate-limit';
import { embedEventNow } from '@/lib/ai/embeddings';

export async function createEvent(
  _prevState: { error: string } | null,
  formData: FormData,
) {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  // Bound unbounded event creation (10/hour); cheap compared to edit fan-out.
  const limited = await enforceRateLimit('eventCreate', userId);
  if (limited) return { error: limited.error };

  const parsed = parseEventForm(formData, { requireFutureDate: true });
  if (!parsed.ok) return { error: parsed.error };

  const event = await prisma.event.create({
    data: {
      ...parsed.data,
      userId,
      organizerName: resolveOrganizerName(session?.user),
    },
    select: { id: true, title: true, description: true, category: true, location: true, organizerName: true },
  });

  // Mark a copilot audit row accepted if the organizer applied a draft.
  const auditId = (formData.get('auditId') as string | null)?.trim() ?? '';
  if (auditId) {
    await prisma.copilotAudit
      .update({ where: { id: auditId }, data: { accepted: true, eventId: event.id } })
      .catch(() => {});
  }

  // Best-effort semantic embedding (non-blocking): never delay redirect.
  void embedEventNow(event).catch((err) => console.error('event embedding failed', err))

  revalidatePath('/events');
  redirect(`/events/${event.id}`);
}

export async function draftEventDescription(
  input: DraftDescriptionInput,
  eventId?: string,
): Promise<{ ok: true; suggestion: CopilotSuggestion; auditId: string } | { ok: false; error: string }> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const limited = await enforceRateLimit('copilot', userId);
  if (limited) return { ok: false, error: limited.error };

  // Validate + normalize input.
  const title = (input.title ?? '').trim();
  const bullets = (input.bullets ?? [])
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (title.length === 0) return { ok: false, error: 'Title is required to draft.' };
  if (title.length > 200) return { ok: false, error: 'Title must be 200 characters or fewer.' };
  if (bullets.length === 0) return { ok: false, error: 'Add at least one bullet point.' };

  const category = input.category;
  const location = input.location?.trim() || undefined;
  const hint =
    input.capacityHint ??
    (await capacityHint(userId, category, location ?? ''));

  const merged: DraftDescriptionInput = {
    title,
    bullets,
    category,
    location,
    capacityHint: hint,
  };

  const result = await draftDescription(merged);

  const audit = await prisma.copilotAudit.create({
    data: {
      userId,
      eventId: eventId ?? null,
      input: merged as unknown as object,
      model: chatModel(),
      rawOutput: result.ok ? result.raw : (result as { raw?: string }).raw ?? null,
      suggestion: result.ok
        ? (result.suggestion as unknown as object)
        : undefined,
      error: result.ok ? null : result.error,
    },
    select: { id: true },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, suggestion: result.suggestion, auditId: audit.id };
}
