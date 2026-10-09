'use client';

import { useState } from 'react';
import { deleteEvent } from './actions';

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <form
      action={async (formData: FormData) => {
        if (!window.confirm('Delete this event and all its RSVPs?')) return;
        setIsPending(true);
        await deleteEvent(formData);
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" disabled={isPending} className="btn-danger text-sm">
        {isPending ? 'Deleting…' : 'Delete event'}
      </button>
    </form>
  );
}
