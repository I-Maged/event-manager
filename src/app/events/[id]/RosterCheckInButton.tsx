'use client';

import { useState, useTransition } from 'react';
import { checkInAttendee, undoCheckIn } from '@/app/events/actions';

type Props = {
  eventId: string;
  attendeeUserId: string;
  initialCheckedIn: boolean;
};

export function RosterCheckInButton({
  eventId,
  attendeeUserId,
  initialCheckedIn,
}: Props) {
  const [checked, setChecked] = useState(initialCheckedIn);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: boolean) {
    setError(null);
    setChecked(next);
    startTransition(async () => {
      try {
        const result = next
          ? await checkInAttendee(eventId, attendeeUserId)
          : await undoCheckIn(eventId, attendeeUserId);
        if (!result.ok) {
          setChecked(!next);
          setError(result.error);
        }
      } catch {
        setChecked(!next);
        setError('Check-in failed. Please retry.');
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        onChange={(e) => handleChange(e.target.checked)}
        aria-label={checked ? 'Undo check-in' : 'Check in attendee'}
        className="h-4 w-4 accent-current cursor-pointer disabled:opacity-60"
      />
      <span className="text-xs text-muted w-16">
        {pending ? 'Saving…' : checked ? 'Checked in' : 'Check in'}
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
