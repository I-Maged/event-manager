'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';

export async function createEvent(
  _prevState: { error: string } | null,
  formData: FormData,
) {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const parsed = parseEventForm(formData, { requireFutureDate: true });
  if (!parsed.ok) return { error: parsed.error };

  const event = await prisma.event.create({
    data: { ...parsed.data, userId },
    select: { id: true },
  });

  revalidatePath('/events');
  redirect(`/events/${event.id}`);
}
