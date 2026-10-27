import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useActionFeedback, GENERIC_ACTION_ERROR } from '@/lib/useActionFeedback';

function Harness({
  fallback = GENERIC_ACTION_ERROR,
}: { fallback?: string } = {}) {
  const { pending, error, setError, run } = useActionFeedback();
  const [result, setResult] = React.useState<string | null>(null);
  const [thrown, setThrown] = React.useState<{ digest?: string } | null>(null);

  return (
    <div>
      <button
        type="button"
        data-testid="run-ok"
        onClick={async () => {
          setThrown(null);
          const out = await run(() => Promise.resolve('ok'), fallback);
          setResult(String(out));
        }}
      >
        run ok
      </button>
      <button
        type="button"
        data-testid="run-deferred"
        onClick={async () => {
          setThrown(null);
          await run(() => deferred.promise, fallback);
        }}
      >
        run deferred
      </button>
      <button
        type="button"
        data-testid="run-fail"
        onClick={async () => {
          setThrown(null);
          await run(() => Promise.reject(new Error('boom')), fallback);
        }}
      >
        run fail
      </button>
      <button
        type="button"
        data-testid="run-redirect"
        onClick={async () => {
          setThrown(null);
          try {
            await run(() =>
              Promise.reject(
                Object.assign(new Error('redirect'), {
                  digest: 'NEXT_REDIRECT;replace;/auth/sign-in;307;',
                }),
              ),
            );
          } catch (e) {
            setThrown(e as { digest?: string });
          }
        }}
      >
        run redirect
      </button>
      <button
        type="button"
        data-testid="set-error"
        onClick={() => setError('stale')}
      >
        set error
      </button>
      <button
        type="button"
        data-testid="resolve-deferred"
        onClick={() => deferred.resolve('deferred-ok')}
      >
        resolve deferred
      </button>
      <span data-testid="pending">{String(pending)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="result">{result ?? ''}</span>
      <span data-testid="thrown">{thrown?.digest ?? ''}</span>
    </div>
  );
}

let deferredResolve: ((v: string) => void) | null = null;
const deferred = {
  promise: new Promise<string>((res) => {
    deferredResolve = res;
  }),
  resolve: (v: string) => deferredResolve?.(v),
};

describe('useActionFeedback', () => {
  beforeEach(() => {
    deferredResolve = null;
    deferred.promise = new Promise<string>((res) => {
      deferredResolve = res;
    });
  });

  it('sets pending during the run and clears it after', async () => {
    render(<Harness />);
    expect(screen.getByTestId('pending').textContent).toBe('false');
    const p = screen.getByTestId('run-deferred');
    await act(async () => {
      p.click();
    });
    expect(screen.getByTestId('pending').textContent).toBe('true');
    await act(async () => {
      screen.getByTestId('resolve-deferred').click();
    });
    expect(screen.getByTestId('pending').textContent).toBe('false');
  });

  it('clears a stale error before each attempt', async () => {
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('set-error').click();
    });
    expect(screen.getByTestId('error').textContent).toBe('stale');
    await act(async () => {
      screen.getByTestId('run-ok').click();
    });
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('uses the provided fallback message on failure', async () => {
    render(<Harness fallback = 'custom failure' />);
    await act(async () => {
      screen.getByTestId('run-fail').click();
    });
    expect(screen.getByTestId('error').textContent).toBe('custom failure');
  });

  it('returns the action result', async () => {
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('run-ok').click();
    });
    expect(screen.getByTestId('result').textContent).toBe('ok');
  });

  it('rethows framework control flow instead of showing it as an error', async () => {
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('run-redirect').click();
    });
    expect(screen.getByTestId('thrown').textContent).toBe(
      'NEXT_REDIRECT;replace;/auth/sign-in;307;',
    );
    expect(screen.getByTestId('error').textContent).toBe('');
  });
});
