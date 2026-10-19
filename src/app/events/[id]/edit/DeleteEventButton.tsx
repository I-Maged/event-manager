'use client';

import { deleteEvent } from './actions';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const { pending, error, run } = useActionFeedback();

  return (
    <form
      action={async (formData: FormData) => {
        if (!window.confirm('Delete this event and all its RSVPs?')) return;
        // `deleteEvent` ends in redirect('/events'). `run` re-throws that
        // control-flow error so the navigation still happens, and only
        // reports a real failure — which would otherwise leave the button
        // stuck on "Deleting…" forever.
        await run(() => deleteEvent(formData));
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-danger text-sm">
          {pending ? 'Deleting…' : 'Delete event'}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
