import { vi } from 'vitest';
import { prisma } from './db';

/**
 * Fault injection for the DB suite.
 *
 * Phase 6 asks for proof that every best-effort path degrades instead of
 * cascading: a notification fan-out that fails must not roll back the write it
 * describes, and a limiter outage must not block the action it guards. Those
 * branches cannot be reached through normal fixtures, so each test rejects one
 * `prisma` call for the duration of a block and then restores it.
 *
 * Always restore in `finally` (or via `duringFault`): the DB project is serial,
 * so a leaked stub would silently poison every later test in the run.
 */

export type Fault = {
  error: Error;
  restore: () => void;
};

/** Models this suite injects into; keeps typos out of the tests. */
export type PrismaDelegateName =
  | 'notification'
  | 'comment'
  | 'rSVP'
  | 'event'
  | 'rateLimit';

type Spied = {
  mockRejectedValue: (error: unknown) => void;
  mockRestore: () => void;
};

type DelegateTarget = Record<string, (...args: unknown[]) => unknown>;

function spyOnDelegate(
  target: DelegateTarget,
  method: string,
  error: Error,
): Fault {
  const original = target[method];
  if (typeof original !== 'function') {
    throw new Error(`cannot inject into a missing method: ${method}`);
  }
  const spy = vi.spyOn(target, method) as unknown as Spied;
  spy.mockRejectedValue(error);
  return { error, restore: () => spy.mockRestore() };
}

/** Reject one model delegate method, e.g. `notification.createMany`. */
export function failModel(
  model: PrismaDelegateName,
  method: string,
  error: Error = new Error('injected database failure'),
): Fault {
  return spyOnDelegate(
    prisma[model] as unknown as DelegateTarget,
    method,
    error,
  );
}

/** Reject a client-level method, e.g. `$queryRaw` (the rate limiter). */
export function failPrismaMethod(
  method: '$queryRaw' | '$executeRaw',
  error: Error = new Error('injected database failure'),
): Fault {
  return spyOnDelegate(
    prisma as unknown as DelegateTarget,
    method,
    error,
  );
}

/** Run `block` while the fault is active, restoring even when it throws. */
export async function duringFault<T>(
  fault: Fault,
  block: () => Promise<T>,
): Promise<T> {
  try {
    return await block();
  } finally {
    fault.restore();
  }
}

export type ConsoleErrorCapture = {
  /** All captured `console.error` calls, flattened to searchable text. */
  text: () => string;
  /** Number of `console.error` calls. */
  count: () => number;
  restore: () => void;
};

/**
 * Collect `console.error` output instead of printing it. Assertions here are
 * about *correlatable* log lines (a marker plus an id), never about prose.
 */
export function captureConsoleError(): ConsoleErrorCapture {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const render = () =>
    spy.mock.calls
      .map((args) =>
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' '),
      )
      .join('\n');

  return {
    text: render,
    count: () => spy.mock.calls.length,
    restore: () => spy.mockRestore(),
  };
}
