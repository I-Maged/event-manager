'use client';

import { useState } from 'react';
import { markAllRead, markRead } from './actions';

export function MarkReadButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null;

  async function handleMarkRead() {
    setPending(true);
    try {
      const result = await markRead(id);
      if (result.ok) setDone(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleMarkRead}
      className="shrink-0 text-xs font-medium underline underline-offset-2 cursor-pointer disabled:opacity-60 text-muted hover:text-foreground"
    >
      {pending ? 'Marking…' : 'Mark read'}
    </button>
  );
}

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const [pending, setPending] = useState(false);

  async function handleMarkAll() {
    setPending(true);
    try {
      await markAllRead();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending || disabled}
      onClick={handleMarkAll}
      className="btn-secondary text-sm disabled:opacity-60"
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
