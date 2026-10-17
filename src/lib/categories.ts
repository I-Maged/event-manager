import type { EventCategory } from '@/generated/prisma';

export type CategoryOption = {
  value: EventCategory;
  label: string;
};

/**
 * Canonical category list, in display order. Values mirror the Prisma
 * `EventCategory` enum (single source of truth for labels/ordering in the UI).
 * `import type` above keeps the generated Prisma runtime out of client bundles.
 */
export const EVENT_CATEGORIES: CategoryOption[] = [
  { value: 'MUSIC', label: 'Music' },
  { value: 'SPORTS', label: 'Sports & Fitness' },
  { value: 'TECH', label: 'Tech' },
  { value: 'ARTS', label: 'Arts & Culture' },
  { value: 'FOOD', label: 'Food & Drink' },
  { value: 'WELLNESS', label: 'Health & Wellness' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'BUSINESS', label: 'Business & Networking' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'OTHER', label: 'Other' },
];

/** Fallback used when no category is supplied (matches the schema default). */
export const DEFAULT_CATEGORY: EventCategory = 'OTHER';

const CATEGORY_VALUES = new Set<string>(
  EVENT_CATEGORIES.map((category) => category.value),
);

/** Narrow an arbitrary form value to a known `EventCategory`. */
export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && CATEGORY_VALUES.has(value);
}

/** Human-readable label for a category value (falls back to "Other"). */
export function categoryLabel(value: EventCategory): string {
  return (
    EVENT_CATEGORIES.find((category) => category.value === value)?.label ??
    'Other'
  );
}
