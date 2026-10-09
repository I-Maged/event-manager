import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { RsvpControls } from '@/components/RsvpControls';
import { auth } from '@/lib/auth/server';
// Session-gated visibility + live RSVP counts: render on demand.
export const instant = false;

import {
  canViewEvent,
  formatEventDate,
  getEventById,
  getRsvpCounts,
  getUserRsvp,
  getWaitlistPosition,
  getWishlist,
  spotsLeft,
} from '@/lib/events';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getEventById(id);
  if (!event) return { title: 'Event not found' };
  // Same visibility rule as the page: never leak private titles to metadata.
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!(await canViewEvent(event, userId))) return { title: 'Event not found' };
  return { title: `${event.title} | EventPlanner` };
}

async function RsvpSection({ eventId }: { eventId: string }) {
  // Current-time comparison below: always render at request time.
  await connection();
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  const event = await getEventById(eventId);
  if (!event) notFound();

  const counts = await getRsvpCounts(eventId);
  const left = spotsLeft(event, counts.GOING);
  const isPast = event.date < new Date();

  if (!userId) {
    return (
      <div className="card p-6 text-center space-y-3">
        <p className="text-sm text-muted">Sign in to RSVP to this event.</p>
        <Link href="/auth/sign-in" className="btn-primary text-sm">
          Sign in
        </Link>
      </div>
    );
  }

  const rsvp = await getUserRsvp(eventId, userId);
  const status = rsvp?.status ?? null;
  const waitlistPosition =
    status === 'WAITLISTED'
      ? await getWaitlistPosition(eventId, userId)
      : null;

  return (
    <RsvpControls
      eventId={eventId}
      currentStatus={status}
      isPast={isPast}
      isFull={left !== null && left <= 0}
      isCapped={event.maxAttendees != null}
      waitlistPosition={waitlistPosition}
      wasPromoted={rsvp?.promotedAt != null}
    />
  );
}

async function OrganizerWishlistPanel({ eventId }: { eventId: string }) {
  const wishlist = await getWishlist(eventId);
  if (wishlist.length === 0) return null;
  return (
    <div className="card p-6 space-y-3">
      <h2 className="font-semibold">
        Wishlist ({wishlist.length})
      </h2>
      <p className="text-sm text-muted">
        If a spot opens, #1 moves up automatically.
      </p>
      <ol className="space-y-2">
        {wishlist.map((entry, i) => (
          <li
            key={entry.userId}
            className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2 last:border-0 last:pb-0"
          >
            <span className="font-medium">#{i + 1}</span>
            <span className="text-muted">
              joined{' '}
              {entry.createdAt.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Current-time comparison below: always render at request time.
  await connection();
  const event = await getEventById(id);
  if (!event) notFound();

  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!(await canViewEvent(event, userId))) notFound();

  const counts = await getRsvpCounts(id);
  const left = spotsLeft(event, counts.GOING);
  const isOrganizer = userId !== null && event.userId === userId;
  const isPast = event.date < new Date();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Link href="/events" className="text-sm text-primary hover:underline">
        ← All events
      </Link>

      <div className="card p-8 space-y-4">
        {isOrganizer && (
          <p className="rounded-md px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200">
            Your event — you&apos;re hosting this.
          </p>
        )}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-3xl font-bold">{event.title}</h1>
          {!event.isPublic && (
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
              Private
            </span>
          )}
        </div>
        {!isOrganizer && event.organizerName && (
          <p className="text-sm text-muted">
            Organized by {event.organizerName} ·{' '}
            <Link
              href={`/events?organizer=${event.userId}`}
              className="text-primary hover:underline"
            >
              More by {event.organizerName}
            </Link>
          </p>
        )}
        <p className="text-sm text-muted">
          {formatEventDate(event.date)} · {event.location}
        </p>
        <p className="whitespace-pre-wrap">{event.description}</p>
        <p className="text-sm text-muted">
          {counts.GOING} going · {counts.MAYBE} maybe · {counts.WAITLISTED}{' '}
          on the wishlist
          {event.maxAttendees != null &&
            (left !== null && left > 0
              ? ` · ${left} of ${event.maxAttendees} spots left`
              : ` · full (${event.maxAttendees} cap)`)}
          {isPast && ' · This event has ended'}
        </p>

        {isOrganizer && (
          <div className="flex gap-3 pt-2">
            <Link href={`/events/${event.id}/edit`} className="btn-secondary text-sm">
              Edit event
            </Link>
          </div>
        )}
      </div>

      <Suspense
        fallback={
          <div className="card p-6 text-center">
            <p className="text-sm text-muted">Loading RSVP…</p>
          </div>
        }
      >
        <RsvpSection eventId={event.id} />
      </Suspense>

      {isOrganizer && event.maxAttendees != null && (
        <Suspense fallback={null}>
          <OrganizerWishlistPanel eventId={event.id} />
        </Suspense>
      )}
    </div>
  );
}
