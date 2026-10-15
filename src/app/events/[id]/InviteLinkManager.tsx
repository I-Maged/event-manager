'use client';

import { useState } from 'react';
import {
  createInviteLink,
  regenerateInviteLink,
  revokeInviteLink,
} from '@/app/events/actions';

type Props = {
  eventId: string;
  initialToken: string | null;
};

export function InviteLinkManager({ eventId, initialToken }: Props) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, setPending] = useState<'create' | 'regenerate' | 'revoke' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/invite/${token}`
      : `/invite/${token}`
    : null;

  async function run(
    kind: 'create' | 'regenerate' | 'revoke',
    fn: () => Promise<{ ok: boolean; token?: string; error?: string }>,
  ) {
    if (kind !== 'create' && !window.confirm(
      kind === 'revoke'
        ? 'Revoke this invite link? Previously shared URLs will stop working.'
        : 'Generate a new link? The current link will stop working.',
    )) {
      return;
    }
    setPending(kind);
    setMessage(null);
    setIsError(false);
    setCopied(false);
    try {
      const result = await fn();
      if (!result.ok) {
        setMessage((result as { error: string }).error ?? 'Something went wrong.');
        setIsError(true);
        return;
      }
      if (kind === 'revoke') {
        setToken(null);
        setMessage('Invite link revoked.');
      } else {
        setToken((result as { token: string }).token);
        setMessage(kind === 'regenerate' ? 'New invite link generated.' : 'Invite link ready.');
      }
    } catch {
      setMessage('Something went wrong. Please retry.');
      setIsError(true);
    } finally {
      setPending(null);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setMessage('Copy failed — select the link manually.');
      setIsError(true);
    }
  }

  return (
    <div className="card p-6 space-y-3">
      <h2 className="font-semibold">Invite link</h2>
      <p className="text-sm text-muted">
        Share one reusable link for this private event. Anyone with the link can
        join as Going (or the wishlist when full). Regenerating invalidates the
        old link.
      </p>

      {url ? (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              aria-label="Invite link"
              className="input-field font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="btn-secondary text-sm shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run('regenerate', () => regenerateInviteLink(eventId))}
              className="text-sm text-muted hover:text-foreground underline underline-offset-2 cursor-pointer disabled:opacity-60"
            >
              {pending === 'regenerate' ? 'Regenerating…' : 'Regenerate link'}
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run('revoke', () => revokeInviteLink(eventId))}
              className="text-sm text-red-700 hover:text-red-800 underline underline-offset-2 cursor-pointer disabled:opacity-60"
            >
              {pending === 'revoke' ? 'Revoking…' : 'Revoke link'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run('create', () => createInviteLink(eventId))}
          className="btn-primary text-sm w-full sm:w-auto"
        >
          {pending === 'create' ? 'Creating…' : 'Create invite link'}
        </button>
      )}

      {message && (
        <div role={isError ? 'alert' : 'status'} className={isError ? 'alert-error' : 'text-sm text-muted'}>
          {message}
        </div>
      )}
    </div>
  );
}
