'use client';

import { useActionState, useSyncExternalStore, useState, useTransition } from 'react';
import Link from 'next/link';
import { EVENT_CATEGORIES, DEFAULT_CATEGORY } from '@/lib/categories';
import { createEvent, draftEventDescription } from './actions';
import type { CopilotSuggestion } from '@/lib/event-validation';
import type { EventCategory } from '@/generated/prisma';

const subscribeNoop = () => () => {};
const getBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
const getServerTimeZone = () => '';

function useBrowserTimeZone(): string {
  return useSyncExternalStore(
    subscribeNoop,
    getBrowserTimeZone,
    getServerTimeZone,
  );
}

function splitBullets(raw: string): string[] {
  return raw
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NewEventPage() {
  const [state, formAction, isPending] = useActionState(createEvent, null);
  const timeZone = useBrowserTimeZone();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [category, setCategory] = useState<EventCategory>(DEFAULT_CATEGORY);
  const [bullets, setBullets] = useState('');
  const [suggestion, setSuggestion] = useState<CopilotSuggestion | null>(null);
  const [auditId, setAuditId] = useState('');
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotPending, startCopilot] = useTransition();

  async function handleDraft() {
    setCopilotError(null);
    startCopilot(async () => {
      const res = await draftEventDescription({
        title,
        bullets: splitBullets(bullets),
        category,
        location,
      });
      if (!res.ok) {
        setCopilotError(res.error);
        return;
      }
      setSuggestion(res.suggestion);
      setAuditId(res.auditId);
    });
  }

  function applySuggestion() {
    if (!suggestion) return;
    if (suggestion.title) setTitle(suggestion.title);
    if (suggestion.description) setDescription(suggestion.description);
    if (suggestion.category) setCategory(suggestion.category);
    if (suggestion.capacity != null) setMaxAttendees(String(suggestion.capacity));
    setSuggestion(null);
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="card p-8 space-y-6">
        <h1 className="text-2xl font-bold">Create event</h1>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="timeZone" value={timeZone} readOnly />
          <input type="hidden" name="auditId" value={auditId} readOnly />

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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bullets" className="block text-sm font-medium">
              Bullet points <span className="text-muted">(for drafting)</span>
            </label>
            <textarea
              id="bullets"
              rows={3}
              placeholder="One point per line"
              className="input-field"
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDraft}
              disabled={copilotPending}
              className="btn-secondary text-sm"
            >
              {copilotPending ? 'Drafting…' : 'Draft description'}
            </button>
          </div>

          {copilotError && <div className="alert-error">{copilotError}</div>}

          {suggestion && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-surface">
              <p className="text-sm font-medium">Suggested (review & apply)</p>
              {suggestion.title && (
                <p className="text-sm">
                  <span className="text-muted">Title:</span> {suggestion.title}
                </p>
              )}
              {suggestion.description && (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="text-muted">Description:</span> {suggestion.description}
                </p>
              )}
              {suggestion.category && (
                <p className="text-sm">
                  <span className="text-muted">Category:</span> {suggestion.category}
                </p>
              )}
              {suggestion.capacity != null && (
                <p className="text-sm">
                  <span className="text-muted">Capacity:</span> {suggestion.capacity}
                </p>
              )}
              <button type="button" onClick={applySuggestion} className="btn-primary text-sm">
                Apply all
              </button>
            </div>
          )}

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
                value={location}
                onChange={(e) => setLocation(e.target.value)}
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
              value={maxAttendees}
              onChange={(e) => setMaxAttendees(e.target.value)}
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
              className="input-field"
              value={category}
              onChange={(e) => setCategory(e.target.value as EventCategory)}
            >
              {EVENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
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

          {state?.error && <div className="alert-error">{state.error}</div>}

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

