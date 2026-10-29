import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { auth } from '@/lib/auth/server';
import { getEventByInviteToken } from '@/lib/events';
import { formatEventDate } from '@/lib/time';
import { AcceptInviteButton } from './AcceptInviteButton';

// Invite acceptance is session-gated: render on demand.
export const instant = false;

export async function generateMetadata() {
  // Never leak private event titles to metadata/crawlers.
  return { title: 'Event invite | EventPlanner' };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Current-time comparison (isPast below) + session read: render on demand.
  await connection();
  const event = await getEventByInviteToken(token);

  if (!event) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">Invite not found</h1>
          <p className="text-sm text-muted">
            This invite link is invalid or has been revoked. Ask the organizer
            for a new link.
          </p>
          <Link href="/events" className="btn-secondary text-sm inline-flex">
            Browse public events
          </Link>
        </div>
      </div>
    );
  }

  const isPast = event.date < new Date();
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;

  if (userId && event.userId === userId) redirect(`/events/${event.id}`);

  if (isPast) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="card p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">This event has ended</h1>
          <p className="text-sm text-muted">
            {event.title} took place on {formatEventDate(event.date, event.timeZone)}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="card p-8 space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          You&apos;re invited
        </p>
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="text-sm text-muted">
          {formatEventDate(event.date, event.timeZone)} · {event.location}
        </p>
        {event.isPublic ? (
          <p className="whitespace-pre-wrap text-sm">{event.description}</p>
        ) : (
          <p className="text-sm text-muted">
            This is a private event. Accept the invite to see full details and
            RSVP.
          </p>
        )}

        {!userId ? (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted">
              Sign in to accept this invite.
            </p>
            <div className="flex gap-3">
              <Link
              href={`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="btn-primary flex-1"
            >
              Sign in
            </Link>
            <Link
              href={`/auth/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="btn-secondary text-sm"
            >
              Sign up
            </Link>
            </div>
          </div>
        ) : (
          <div className="pt-2">
            <AcceptInviteButton token={token} />
          </div>
        )}
      </div>
    </div>
  );
}
