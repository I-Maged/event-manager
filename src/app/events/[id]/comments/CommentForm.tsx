'use client';

import { useState } from 'react';
import { addComment } from './actions';
import { MAX_COMMENT_LENGTH } from '@/lib/comments';

export function CommentForm({ eventId }: { eventId: string }) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError('Comment is required.');
      return;
    }
    setPending(true);
    try {
      const result = await addComment(eventId, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody('');
    } catch {
      setError('Something went wrong. Please retry.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor="comment-body" className="sr-only">
        Add a comment
      </label>
      <textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        placeholder="Ask a question or share details…"
        disabled={pending}
        className="input-field w-full disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {body.trim().length}/{MAX_COMMENT_LENGTH}
        </span>
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="btn-primary text-sm disabled:opacity-60"
        >
          {pending ? 'Posting…' : 'Post comment'}
        </button>
      </div>
      {error && (
        <div role="alert" className="alert-error">
          {error}
        </div>
      )}
    </form>
  );
}
