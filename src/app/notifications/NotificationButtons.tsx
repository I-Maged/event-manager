'use client';

import { useState } from 'react';
import { markAllRead, markRead } from './actions';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function MarkReadButton({ id }: { id: string }) {
  const { pending, error, setError, run } = useActionFeedback();
  const [done, setDone] = useState(false);

  async function handleMarkRead() {
    const result = await run(() => markRead(id));
    if (!result) return;
    if (result.ok) setDone(true);
    else setError(result.error);
  }

  if (done) return null;

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleMarkRead}
        className="shrink-0 text-xs font-medium underline underline-offset-2 cursor-pointer disabled:opacity-60 text-muted hover:text-foreground"
      >
        {pending ? 'Marking…' : 'Mark read'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const { pending, error, setError, run } = useActionFeedback();

  async function handleMarkAll() {
    const result = await run(() => markAllRead());
    if (result && !result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={handleMarkAll}
        className="btn-secondary text-sm disabled:opacity-60"
      >
        {pending ? 'Marking…' : 'Mark all read'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
