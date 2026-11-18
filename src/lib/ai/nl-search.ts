import { chatComplete } from './gateway'
import { sanitizeFilters, ParsedFilters } from './types'

const cache = new Map<string, { value: ParsedFilters; expires: number }>()
const TTL = 10 * 60 * 1000

const SYSTEM = `You convert a natural-language event search query into structured filters.
Return ONLY a JSON object with keys: search, category, timeWindow, sort, organizerName.
- search: short keyword string or null
- category: one of MUSIC,SPORTS,TECH,ARTS,FOOD,WELLNESS,COMMUNITY,BUSINESS,EDUCATION,OTHER or null
- timeWindow: "today","week","month" or null
- sort: "date","newest","popular" or null
- organizerName: string or null
Do not include any other keys or prose.`

export async function parseNaturalLanguageQuery(query: string): Promise<ParsedFilters> {
  const trimmed = query.trim().slice(0, 500)
  if (!trimmed) return sanitizeFilters({})
  const now = Date.now()
  const cached = cache.get(trimmed)
  if (cached && cached.expires > now) return cached.value
  let result: ParsedFilters
  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: trimmed },
      ],
      { json: true, temperature: 0 },
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : {}
    }
    result = sanitizeFilters(parsed)
  } catch {
    result = sanitizeFilters({ search: trimmed })
  }
  cache.set(trimmed, { value: result, expires: Date.now() + TTL })
  return result
}