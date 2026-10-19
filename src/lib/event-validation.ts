import type { EventCategory } from '@/generated/prisma';
import { DEFAULT_CATEGORY, isEventCategory } from '@/lib/categories';
import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedTimeToUtc } from '@/lib/time';

export type ParsedEventForm =
  | {
      ok: true;
      data: {
        title: string;
        description: string;
        date: Date;
        timeZone: string | null;
        location: string;
        maxAttendees: number | null;
        isPublic: boolean;
        category: EventCategory;
      };
    }
  | { ok: false; error: string };

/**
 * Shared validation for create/update event forms.
 * `requireFutureDate` is true for creation; updates may keep past dates
 * (e.g. fixing details of an event that already happened).
 *
 * `date` is the raw `datetime-local` wall clock and `timeZone` is the IANA
 * zone captured from the author's browser. The two are combined here, on the
 * server, so the stored instant does not depend on the server's own zone.
 * When `timeZone` is missing (no JS) or invalid, the wall clock is interpreted
 * in `APP_TIME_ZONE` and the column stays null, matching how it will render.
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
  const timeZoneRaw = (formData.get('timeZone') as string | null)?.trim() ?? '';
  const maxRaw = (formData.get('maxAttendees') as string | null)?.trim() ?? '';
  const isPublic = formData.get('isPublic') === 'on';
  const categoryRaw = (formData.get('category') as string | null) ?? '';
  const category: EventCategory = isEventCategory(categoryRaw)
    ? categoryRaw
    : DEFAULT_CATEGORY;

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

  const timeZone = isValidTimeZone(timeZoneRaw) ? timeZoneRaw : null;
  const date = zonedTimeToUtc(dateRaw, timeZone ?? DEFAULT_TIME_ZONE);
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
    data: {
      title,
      description,
      date,
      timeZone,
      location,
      maxAttendees,
      isPublic,
      category,
    },
  };
}
