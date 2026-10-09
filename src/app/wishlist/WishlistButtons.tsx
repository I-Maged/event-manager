'use client';

import { useState } from 'react';
import { cancelRsvp, dismissPromotion } from '@/app/events/actions';

export function LeaveWishlistButton({ eventId }: { eventId: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={async () => {
        if (!window.confirm('Leave this wishlist?')) return;
        setIsPending(true);
        await cancelRsvp(eventId);
      }}
      className="text-sm text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
    >
      {isPending ? 'Leaving…' : 'Leave wishlist'}
    </button>
  );
}

export function DismissPromotionButton({ eventId }: { eventId: string }) {
  const [isPending, setIsPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={async () => {
        setIsPending(true);
        const result = await dismissPromotion(eventId);
        setIsPending(false);
        if (result.ok) setDismissed(true);
      }}
      className="shrink-0 text-xs font-medium underline underline-offset-2 cursor-pointer disabled:opacity-60"
    >
      {isPending ? 'Dismissing…' : 'Dismiss'}
    </button>
  );
}
