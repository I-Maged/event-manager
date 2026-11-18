import { describe, it, expect } from 'vitest'
import { sanitizeFilters } from '@/lib/ai/types'

describe('sanitizeFilters', () => {
  it('keeps valid values', () => {
    const f = sanitizeFilters({ search: 'tech', category: 'TECH', timeWindow: 'week', sort: 'popular', organizerName: 'Org' })
    expect(f.search).toBe('tech')
    expect(f.category).toBe('TECH')
    expect(f.timeWindow).toBe('week')
    expect(f.sort).toBe('popular')
    expect(f.organizerName).toBe('Org')
  })
  it('drops invalid values', () => {
    const f = sanitizeFilters({ search: 'x', category: 'NOPE', timeWindow: 'year', sort: 'random', organizerName: 5 })
    expect(f.search).toBe('x')
    expect(f.category).toBeNull()
    expect(f.timeWindow).toBeNull()
    expect(f.sort).toBeNull()
    expect(f.organizerName).toBeNull()
  })
  it('truncates long search', () => {
    const long = 'a'.repeat(200)
    const f = sanitizeFilters({ search: long })
    expect(f.search?.length).toBe(100)
  })
})