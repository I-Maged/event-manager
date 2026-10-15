'use client';

import { useState } from 'react';
import { deleteComment } from './actions';

export function CommentDeleteButton({ commentId }: { commentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm('Delete this comment?')) return;
    setPending(true);
    setError(null);
    try {
      const result = await deleteComment(commentId);
      if (!result.ok) setError(result.error);
    } catch {
      setError('Delete failed. Please retry.');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleDelete}
        className="text-xs text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
