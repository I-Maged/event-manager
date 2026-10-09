export type ParsedEventForm =
  | {
      ok: true;
      data: {
        title: string;
        description: string;
        date: Date;
        location: string;
        maxAttendees: number | null;
        isPublic: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Shared validation for create/update event forms.
 * `requireFutureDate` is true for creation; updates may keep past dates
 * (e.g. fixing details of an event that already happened).
 */
export function parseEventForm(
  formData: FormData,
  opts: { requireFutureDate: boolean },
): ParsedEventForm {
  const title = (formData.get('title') as string | null)?.trim() ?? '';
  const description =
    (formData.get('description') as string | null)?.trim() ?? '';
  const location = (formData.get('location') as string | null)?.trim() ?? '';
  const dateRaw = (formData.get('date') as string | null) ?? '';
  const maxRaw = (formData.get('maxAttendees') as string | null)?.trim() ?? '';
  const isPublic = formData.get('isPublic') === 'on';

  if (title.length === 0) return { ok: false, error: 'Title is required.' };
  if (title.length > 200)
    return { ok: false, error: 'Title must be 200 characters or fewer.' };
  if (description.length === 0)
    return { ok: false, error: 'Description is required.' };
  if (description.length > 5000)
    return { ok: false, error: 'Description must be 5000 characters or fewer.' };
  if (location.length === 0)
    return { ok: false, error: 'Location is required.' };
  if (location.length > 300)
    return { ok: false, error: 'Location must be 300 characters or fewer.' };

  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime()))
    return { ok: false, error: 'A valid date and time is required.' };
  if (opts.requireFutureDate && date < new Date())
    return { ok: false, error: 'Event date must be in the future.' };

  let maxAttendees: number | null = null;
  if (maxRaw !== '') {
    const n = Number(maxRaw);
    if (!Number.isInteger(n) || n < 1)
      return { ok: false, error: 'Capacity must be a whole number of at least 1.' };
    if (n > 100000)
      return { ok: false, error: 'Capacity must be 100,000 or fewer.' };
    maxAttendees = n;
  }

  return {
    ok: true,
    data: { title, description, date, location, maxAttendees, isPublic },
  };
}

/** Format a Date for <input type="datetime-local"> (local time, no zone). */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
