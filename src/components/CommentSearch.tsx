'use client'

import { useState, useTransition } from 'react'
import { searchComments } from '@/app/events/[id]/comments/search-actions'

type Result = { id: string; body: string; authorName: string | null; createdAt: Date }

export function CommentSearch({ eventId }: { eventId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await searchComments(eventId, query)
      if (!res.ok) {
        setError(res.error ?? 'Search failed.')
        return
      }
      setResults(res.comments as Result[])
    })
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search comments semantically…"
          className="input flex-1"
          aria-label="Semantic comment search"
        />
        <button type="submit" className="btn-secondary text-sm" disabled={pending || !query.trim()}>
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((c) => (
            <li key={c.id} className="text-sm border-b border-border pb-2">
              <span className="font-medium">{c.authorName ?? 'Guest'}: </span>
              {c.body}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}