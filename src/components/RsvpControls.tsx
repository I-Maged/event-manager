'use client';

import { useState } from 'react';
import type { RSVPStatus } from '@/generated/prisma';
import { cancelRsvp, setRsvp, type SettableStatus } from '@/app/events/actions';

type Props = {
  eventId: string;
  currentStatus: RSVPStatus | null;
  isPast: boolean;
  isFull: boolean;
  waitlistPosition: number | null;
};

const BUTTONS: { status: SettableStatus; label: string }[] = [
  { status: 'GOING', label: 'Going' },
  { status: 'MAYBE', label: 'Maybe' },
  { status: 'NOT_GOING', label: "Can't go" },
];

export function RsvpControls({
  eventId,
  currentStatus,
  isPast,
  isFull,
  waitlistPosition,
}: Props) {
  const [status, setStatus] = useState<RSVPStatus | null>(currentStatus);
  const [position, setPosition] = useState<number | null>(waitlistPosition);
  const [pending, setPending] = useState<SettableStatus | 'cancel' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSet(next: SettableStatus) {
    setPending(next);
    setMessage(null);
    setIsError(false);
    const result = await setRsvp(eventId, next);
    setPending(null);
    if (!result.ok) {
      setMessage(result.error);
      setIsError(true);
      return;
    }
    setStatus(result.status);
    setPosition(result.waitlistPosition);
    if (result.status === 'WAITLISTED') {
      setMessage(
        result.waitlistPosition != null
          ? `Event is full — you're #${result.waitlistPosition} on the waitlist.`
          : 'Event is full — you joined the waitlist.',
      );
    } else {
      setMessage(null);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Remove your RSVP?')) return;
    setPending('cancel');
    setMessage(null);
    setIsError(false);
    const result = await cancelRsvp(eventId);
    setPending(null);
    if (!result.ok) {
      setMessage(result.error);
      setIsError(true);
      return;
    }
    setStatus(null);
    setPosition(null);
  }

  if (isPast) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-muted">This event has ended.</p>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-4">
      <h2 className="font-semibold">Your RSVP</h2>

      {isFull && status !== 'GOING' && (
        <p className="text-sm text-muted">
          This event is full — choosing “Going” will join the waitlist.
        </p>
      )}
      {status === 'WAITLISTED' && (
        <p className="text-sm text-muted">
          You&apos;re on the waitlist
          {position != null && ` (#${position})`} — we&apos;ll promote you
          automatically if a spot opens.
        </p>
      )}

      <div className="flex flex-wrap gap-3" role="group" aria-label="RSVP choice">
        {BUTTONS.map(({ status: s, label }) => (
          <button
            key={s}
            type="button"
            disabled={pending !== null}
            aria-pressed={status === s}
            onClick={() => handleSet(s)}
            className={
              s === 'GOING'
                ? `btn-primary text-sm ${status === s ? 'ring-2 ring-offset-2 ring-primary' : ''}`
                : `btn-secondary text-sm ${status === s ? 'ring-2 ring-offset-2 ring-secondary' : ''}`
            }
          >
            {pending === s ? 'Saving…' : label}
          </button>
        ))}
      </div>

      {status && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleCancel}
          className="text-sm text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
        >
          {pending === 'cancel' ? 'Removing…' : 'Remove RSVP'}
        </button>
      )}

      {message && (
        <div
          role={isError ? 'alert' : 'status'}
          className={isError ? 'alert-error' : 'text-sm text-muted'}
        >
          {message}
        </div>
      )}
    </div>
  );
}
