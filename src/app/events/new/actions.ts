'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';
import { resolveOrganizerName } from '@/lib/events';
import { enforceRateLimit } from '@/lib/rate-limit';

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
    select: { id: true },
  });

  revalidatePath('/events');
  redirect(`/events/${event.id}`);
}
