import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { RsvpControls } from '@/components/RsvpControls';
import { CalendarLinks } from '@/components/CalendarLinks';
import { InviteLinkManager } from './InviteLinkManager';
import { RosterCheckInButton } from './RosterCheckInButton';
import { auth } from '@/lib/auth/server';
import { categoryLabel } from '@/lib/categories';
import type { Event } from '@/generated/prisma';
// Session-gated visibility + live RSVP counts: render on demand.
export const instant = false;

import {
  canViewEvent,
  getAttendees,
  getCommentCount,
  getComments,
  getEventByIdCached,
  getInviteToken,
  getRsvpCountsCached,
  getUserRsvp,
  getWaitlistPosition,
  getWishlist,
  spotsLeft,
} from '@/lib/events';
import { formatEventDate } from '@/lib/time';
import { CommentForm } from './comments/CommentForm';
import { CommentDeleteButton } from './comments/CommentDeleteButton';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Session + DB read below must run at request time, not during prerender.
  await connection();
  const { id } = await params;
  const event = await getEventByIdCached(id);
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
  const event = await getEventByIdCached(eventId);
  if (!event) notFound();

  const counts = await getRsvpCountsCached(eventId);
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
      initialNotifyOnUpdate={rsvp?.notifyOnUpdate ?? true}
    />
  );
}

async function CommentSection({ eventId }: { eventId: string }) {
  // Session + visibility check: render at request time.
  await connection();
  const { data: session } = await auth.getSession();
  const viewerId = session?.user?.id ?? null;
  const event = await getEventByIdCached(eventId);
  if (!event) return null;
  if (!(await canViewEvent(event, viewerId))) return null;

  const [comments, commentCount] = await Promise.all([
    getComments(event, viewerId),
    getCommentCount(eventId),
  ]);
  const isPast = event.date < new Date();

  return (
    <div className="card p-6 space-y-4">
      <h2 className="font-semibold">Comments ({commentCount})</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted">
          No comments yet. Ask a question or share details.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => {
            const isOrganizer = comment.userId === event.userId;
            const canDelete =
              viewerId !== null &&
              (viewerId === comment.userId || viewerId === event.userId);
            return (
              <li
                key={comment.id}
                className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {comment.authorName ?? 'Guest'}
                  </span>
                  {isOrganizer && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                      Organizer
                    </span>
                  )}
                  <span className="text-xs text-muted">
                    {comment.createdAt.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
                {canDelete && <CommentDeleteButton commentId={comment.id} />}
              </li>
            );
          })}
        </ul>
      )}
      {!viewerId ? (
        <p className="text-sm text-muted">
          <Link href="/auth/sign-in" className="text-primary hover:underline">
            Sign in
          </Link>{' '}
          to join the discussion.
        </p>
      ) : isPast ? (
        <p className="text-sm text-muted">
          This event has ended — comments are read-only.
        </p>
      ) : (
        <CommentForm eventId={eventId} />
      )}
    </div>
  );
}

async function OrganizerWishlistPanel({ event }: { event: Event }) {
  const wishlist = await getWishlist(event, event.userId);
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

const STATUS_LABEL: Record<string, string> = {
  GOING: 'Going',
  MAYBE: 'Maybe',
  NOT_GOING: "Can't go",
  WAITLISTED: 'Wishlist',
};

async function OrganizerRosterPanel({ event }: { event: Event }) {
  const eventId = event.id;
  const attendees = await getAttendees(event, event.userId);
  if (attendees.length === 0) {
    return (
      <div className="card p-6 space-y-2">
        <h2 className="font-semibold">Attendees (0)</h2>
        <p className="text-sm text-muted">
          No RSVPs yet. Share your event or invite link to fill seats.
        </p>
      </div>
    );
  }
  const going = attendees.filter((a) => a.status === 'GOING');
  const checkedIn = going.filter((a) => a.checkedInAt != null).length;
  const checkInPct =
    going.length > 0 ? Math.round((checkedIn / going.length) * 100) : 0;
  return (
    <div className="card p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Attendees ({attendees.length})</h2>
        <a
          href={`/api/events/${eventId}/attendees`}
          className="text-sm text-primary hover:underline"
        >
          Export CSV
        </a>
      </div>
      {going.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted">
            Checked in {checkedIn}/{going.length} going ({checkInPct}%)
          </p>
          <div
            role="progressbar"
            aria-valuenow={checkInPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Check-in progress"
            className="h-2 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${checkInPct}%` }}
            />
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {attendees.map((a, i) => (
          <li
            key={a.userId}
            className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2 last:border-0 last:pb-0"
          >
            <span className="font-medium truncate">
              {a.attendeeName ?? `Guest #${i + 1}`}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                {STATUS_LABEL[a.status] ?? a.status}
              </span>
              {a.status === 'GOING' && (
                <RosterCheckInButton
                  eventId={eventId}
                  attendeeUserId={a.userId}
                  initialCheckedIn={a.checkedInAt != null}
                />
              )}
              <span className="text-xs text-muted hidden sm:inline">
                {a.createdAt.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function OrganizerInvitePanel({ eventId }: { eventId: string }) {
  const token = await getInviteToken(eventId);
  return <InviteLinkManager eventId={eventId} initialToken={token} />;
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Current-time comparison below: always render at request time.
  await connection();
  const event = await getEventByIdCached(id);
  if (!event) notFound();

  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!(await canViewEvent(event, userId))) notFound();

  const counts = await getRsvpCountsCached(id);
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Link
              href={`/events?category=${event.category}`}
              className="badge-organizer hover:underline"
            >
              {categoryLabel(event.category)}
            </Link>
            {!event.isPublic && (
              <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                Private
              </span>
            )}
          </div>
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
          {formatEventDate(event.date, event.timeZone)} · {event.location}
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
          <p className="rounded-md px-3 py-2 text-sm text-muted bg-surface border border-border">
            Going {counts.GOING} · Maybe {counts.MAYBE} · Can&apos;t go{' '}
            {counts.NOT_GOING} · Wishlist {counts.WAITLISTED}
            {event.maxAttendees != null && event.maxAttendees > 0
              ? ` · Fill ${Math.round((counts.GOING / event.maxAttendees) * 100)}% (${counts.GOING}/${event.maxAttendees})`
              : ' · Uncapped'}
          </p>
        )}

        {isOrganizer && (
          <div className="flex gap-3 pt-2">
            <Link href={`/events/${event.id}/edit`} className="btn-secondary text-sm">
              Edit event
            </Link>
          </div>
        )}

        <p className="text-sm text-muted">
          Add to calendar:{' '}
          <CalendarLinks event={event} className="inline-flex flex-wrap gap-x-3" />
        </p>
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

      <Suspense
        fallback={
          <div className="card p-6 text-center">
            <p className="text-sm text-muted">Loading comments…</p>
          </div>
        }
      >
        <CommentSection eventId={event.id} />
      </Suspense>

      {isOrganizer && event.maxAttendees != null && (
        <Suspense fallback={null}>
          <OrganizerWishlistPanel event={event} />
        </Suspense>
      )}

      {isOrganizer && (
        <Suspense
          fallback={
            <div className="card p-6 text-center">
              <p className="text-sm text-muted">Loading attendees…</p>
            </div>
          }
        >
          <OrganizerRosterPanel event={event} />
        </Suspense>
      )}

      {isOrganizer && !event.isPublic && (
        <Suspense fallback={null}>
          <OrganizerInvitePanel eventId={event.id} />
        </Suspense>
      )}
    </div>
  );
}
