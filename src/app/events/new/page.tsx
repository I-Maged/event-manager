'use client';

import { useActionState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { EVENT_CATEGORIES, DEFAULT_CATEGORY } from '@/lib/categories';
import { createEvent } from './actions';

const subscribeNoop = () => () => {};
const getBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
const getServerTimeZone = () => '';

/**
 * The author's IANA zone. `useSyncExternalStore` reads the browser-only value
 * after hydration (server snapshot is empty), so the server-rendered markup
 * and the first client render agree. The server falls back to APP_TIME_ZONE
 * when this is empty (no JS).
 */
function useBrowserTimeZone(): string {
  return useSyncExternalStore(
    subscribeNoop,
    getBrowserTimeZone,
    getServerTimeZone,
  );
}

export default function NewEventPage() {
  const [state, formAction, isPending] = useActionState(createEvent, null);
  const timeZone = useBrowserTimeZone();

  return (
    <div className="max-w-xl mx-auto">
      <div className="card p-8 space-y-6">
        <h1 className="text-2xl font-bold">Create event</h1>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="timeZone" value={timeZone} readOnly />

          <div className="space-y-1.5">
            <label htmlFor="title" className="block text-sm font-medium">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={200}
              placeholder="Neighborhood picnic"
              className="input-field"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              required
              rows={4}
              placeholder="What should guests expect?"
              className="input-field"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="date" className="block text-sm font-medium">
                Date and time
              </label>
              <input
                id="date"
                name="date"
                type="datetime-local"
                required
                className="input-field"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="location" className="block text-sm font-medium">
                Location
              </label>
              <input
                id="location"
                name="location"
                type="text"
                required
                maxLength={300}
                placeholder="Central Park, NYC"
                className="input-field"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="maxAttendees" className="block text-sm font-medium">
              Capacity <span className="text-muted">(optional)</span>
            </label>
            <input
              id="maxAttendees"
              name="maxAttendees"
              type="number"
              min={1}
              step={1}
              placeholder="Leave empty for unlimited"
              className="input-field"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="category" className="block text-sm font-medium">
              Category
            </label>
            <select
              id="category"
              name="category"
              required
              defaultValue={DEFAULT_CATEGORY}
              className="input-field"
            >
              {EVENT_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isPublic"
              name="isPublic"
              type="checkbox"
              defaultChecked
              className="h-4 w-4 accent-indigo-600"
            />
            <label htmlFor="isPublic" className="text-sm">
              Public event (anyone can discover it)
            </label>
          </div>

          {state?.error && (
            <div className="alert-error">{state.error}</div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary flex-1"
            >
              {isPending ? 'Creating…' : 'Create event'}
            </button>
            <Link href="/events" className="btn-secondary text-sm">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
