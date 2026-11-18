export const EVENT_CATEGORIES = [
  'MUSIC',
  'SPORTS',
  'TECH',
  'ARTS',
  'FOOD',
  'WELLNESS',
  'COMMUNITY',
  'BUSINESS',
  'EDUCATION',
  'OTHER',
] as const

export type EventCategoryValue = (typeof EVENT_CATEGORIES)[number]

export type TimeWindow = 'today' | 'week' | 'month' | null

export type SortOption = 'date' | 'newest' | 'popular'

export interface ParsedFilters {
  search: string | null
  category: EventCategoryValue | null
  timeWindow: TimeWindow
  sort: SortOption | null
  organizerName: string | null
}

export function emptyFilters(): ParsedFilters {
  return { search: null, category: null, timeWindow: null, sort: null, organizerName: null }
}

export function sanitizeFilters(raw: unknown): ParsedFilters {
  const f = emptyFilters()
  if (!raw || typeof raw !== 'object') return f
  const r = raw as Record<string, unknown>
  if (typeof r.search === 'string' && r.search.trim()) f.search = r.search.trim().slice(0, 100)
  if (typeof r.category === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(r.category)) {
    f.category = r.category as EventCategoryValue
  }
  if (r.timeWindow === 'today' || r.timeWindow === 'week' || r.timeWindow === 'month') {
    f.timeWindow = r.timeWindow
  }
  if (r.sort === 'date' || r.sort === 'newest' || r.sort === 'popular') f.sort = r.sort
  if (typeof r.organizerName === 'string' && r.organizerName.trim()) {
    f.organizerName = r.organizerName.trim().slice(0, 80)
  }
  return f
}