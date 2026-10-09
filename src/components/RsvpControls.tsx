'use client';

import { useState } from 'react';
import type { RSVPStatus } from '@/generated/prisma';
import {
  cancelRsvp,
  dismissPromotion,
  joinWishlist,
  setRsvp,
  type SettableStatus,
} from '@/app/events/actions';

type Props = {
  eventId: string;
  currentStatus: RSVPStatus | null;
  isPast: boolean;
  isFull: boolean;
  isCapped: boolean;
  waitlistPosition: number | null;
  wasPromoted: boolean;
};

const BUTTONS: { status: SettableStatus; label: string }[] = [
  { status: 'GOING', label: 'Going' },
  { status: 'MAYBE', label: 'Maybe' },
  { status: 'NOT_GOING', label: "Can't go" },
];

type Pending = SettableStatus | 'wishlist' | 'cancel' | 'dismiss' | null;

export function RsvpControls({
  eventId,
  currentStatus,
  isPast,
  isFull,
  isCapped,
  waitlistPosition,
  wasPromoted,
}: Props) {
  const [status, setStatus] = useState<RSVPStatus | null>(currentStatus);
  const [position, setPosition] = useState<number | null>(waitlistPosition);
  const [promoted, setPromoted] = useState(wasPromoted);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function applyResult(result: { ok: true; status: RSVPStatus; waitlistPosition: number | null }) {
    setStatus(result.status);
    setPosition(result.waitlistPosition);
    if (result.status === 'WAITLISTED') {
      setMessage(
        result.waitlistPosition != null
          ? `You're #${result.waitlistPosition} on the wishlist — we'll move you up automatically if a spot opens.`
          : 'You joined the wishlist.',
      );
    } else {
      setMessage(null);
    }
  }

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
    applyResult(result);
  }

  async function handleJoinWishlist() {
    setPending('wishlist');
    setMessage(null);
    setIsError(false);
    const result = await joinWishlist(eventId);
    setPending(null);
    if (!result.ok) {
      setMessage(result.error);
      setIsError(true);
      return;
    }
    applyResult(result);
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
    setPromoted(false);
  }

  async function handleDismissPromotion() {
    setPending('dismiss');
    const result = await dismissPromotion(eventId);
    setPending(null);
    if (result.ok) setPromoted(false);
  }

  if (isPast) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-muted">This event has ended.</p>
      </div>
    );
  }

  const showWishlistCta = isCapped && isFull && status === null;

  return (
    <div className="card p-6 space-y-4">
      <h2 className="font-semibold">Your RSVP</h2>

      {promoted && status === 'GOING' && (
        <div className="rounded-md px-3 py-2 text-sm text-green-700 bg-green-50 border border-green-200 flex items-center justify-between gap-3">
          <span>You got in! A spot opened up and you moved off the wishlist.</span>
          <button
            type="button"
            disabled={pending !== null}
            onClick={handleDismissPromotion}
            className="shrink-0 text-xs font-medium underline underline-offset-2 cursor-pointer disabled:opacity-60"
          >
            {pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}

      {showWishlistCta ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            This event is full. Join the wishlist and you&apos;ll move up
            automatically if someone can&apos;t go.
          </p>
          <button
            type="button"
            disabled={pending !== null}
            onClick={handleJoinWishlist}
            className="btn-primary text-sm w-full sm:w-auto"
          >
            {pending === 'wishlist' ? 'Joining…' : 'Join wishlist'}
          </button>
        </div>
      ) : (
        <>
          {isFull && status !== 'GOING' && status !== 'WAITLISTED' && (
            <p className="text-sm text-muted">
              This event is full — choosing “Going” will join the wishlist.
            </p>
          )}
          {status === 'WAITLISTED' && (
            <p className="text-sm text-muted">
              You&apos;re on the wishlist
              {position != null && ` (#${position})`} — you&apos;ll move up
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
        </>
      )}

      {status && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleCancel}
          className="text-sm text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
        >
          {pending === 'cancel'
            ? 'Removing…'
            : status === 'WAITLISTED'
              ? 'Leave wishlist'
              : 'Remove RSVP'}
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
