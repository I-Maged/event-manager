'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { searchEventsNL } from '@/app/events/search-actions'

export function NaturalLanguageSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await searchEventsNL(query)
      if (!res.ok || !res.filters) {
        setError(res.error ?? 'Search failed. Try again.')
        return
      }
      const f = res.filters
      const params = new URLSearchParams()
      if (f.search) params.set('q', f.search)
      if (f.category) params.set('category', f.category)
      if (f.timeWindow) params.set('when', f.timeWindow)
      if (f.sort) params.set('sort', f.sort)
      if (f.organizerName) params.set('organizer', f.organizerName)
      params.set('nl', '1')
      router.push(`/events?${params.toString()}`)
    })
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Describe what you're looking for…"
        className="input flex-1"
        aria-label="Natural language search"
      />
      <button type="submit" className="btn-primary" disabled={pending || !query.trim()}>
        {pending ? 'Searching…' : 'AI search'}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  )
}