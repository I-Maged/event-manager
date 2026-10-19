'use client';

import { useState } from 'react';
import { cancelRsvp, dismissPromotion } from '@/app/events/actions';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function LeaveWishlistButton({ eventId }: { eventId: string }) {
  const { pending, error, setError, run } = useActionFeedback();

  async function handleLeave() {
    if (!window.confirm('Leave this wishlist?')) return;
    const result = await run(() => cancelRsvp(eventId));
    if (result && !result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleLeave}
        className="text-sm text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
      >
        {pending ? 'Leaving…' : 'Leave wishlist'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}

export function DismissPromotionButton({ eventId }: { eventId: string }) {
  const { pending, error, setError, run } = useActionFeedback();
  const [dismissed, setDismissed] = useState(false);

  async function handleDismiss() {
    const result = await run(() => dismissPromotion(eventId));
    if (!result) return;
    if (result.ok) setDismissed(true);
    else setError(result.error);
  }

  if (dismissed) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleDismiss}
        className="shrink-0 text-xs font-medium underline underline-offset-2 cursor-pointer disabled:opacity-60"
      >
        {pending ? 'Dismissing…' : 'Dismiss'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
