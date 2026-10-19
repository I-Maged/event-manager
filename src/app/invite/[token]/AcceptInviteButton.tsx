'use client';

import { useState } from 'react';
import Link from 'next/link';
import { acceptInvite } from '@/app/events/actions';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function AcceptInviteButton({ token }: { token: string }) {
  const { pending, error, setError, run } = useActionFeedback();
  const [message, setMessage] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);

  async function handleAccept() {
    setMessage(null);
    const result = await run(() => acceptInvite(token));
    if (!result) return;
    if (!result.ok) {
      setError(result.error);
      if ('eventId' in result && result.eventId) setEventId(result.eventId);
      return;
    }
    if (result.status === 'WAITLISTED') {
      setMessage(
        result.waitlistPosition != null
          ? `You're #${result.waitlistPosition} on the wishlist — we'll move you up automatically if a spot opens.`
          : 'You joined the wishlist.',
      );
    } else {
      setMessage("You're in! See you there.");
    }
    if ('eventId' in result && result.eventId) setEventId(result.eventId);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending || eventId !== null}
        onClick={handleAccept}
        className="btn-primary w-full"
      >
        {pending ? 'Joining…' : eventId ? 'Joined!' : 'Accept invite — Join as Going'}
      </button>
      {error && (
        <div role="alert" className="alert-error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="text-sm text-muted">
          {message}
        </div>
      )}
      {eventId && (
        <Link href={`/events/${eventId}`} className="btn-secondary w-full text-sm">
          View event
        </Link>
      )}
    </div>
  );
}
