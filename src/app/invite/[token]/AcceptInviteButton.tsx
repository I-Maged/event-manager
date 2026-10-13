'use client';

import { useState } from 'react';
import Link from 'next/link';
import { acceptInvite } from '@/app/events/actions';

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);

  async function handleAccept() {
    setPending(true);
    setMessage(null);
    setIsError(false);
    const result = await acceptInvite(token);
    setPending(false);
    if (!result.ok) {
      setMessage(result.error);
      setIsError(true);
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
      {message && (
        <div
          role={isError ? 'alert' : 'status'}
          className={isError ? 'alert-error' : 'text-sm text-muted'}
        >
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
