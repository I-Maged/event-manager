import { requireEnv } from '@/lib/env'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

function headers() {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${requireEnv('OPENROUTER_API_KEY')}`,
  }
  const siteUrl = process.env.OPENROUTER_SITE_URL
  const siteName = process.env.OPENROUTER_SITE_NAME
  if (siteUrl) h['HTTP-Referer'] = siteUrl
  if (siteName) h['X-Title'] = siteName
  return h
}

export function embeddingModel() {
  return process.env.OPENROUTER_EMBEDDING_MODEL ?? 'nvidia/nemotron-3-embed-1b:free'
}

export function chatModel() {
  return process.env.OPENROUTER_CHAT_MODEL ?? 'openrouter/free'
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return []
  const body = JSON.stringify({ model: embeddingModel(), input: inputs })
  const init: RequestInit = { method: 'POST', headers: headers(), body }
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${OPENROUTER_BASE}/embeddings`, init, 15_000)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500))
          lastErr = new Error(`OpenRouter embeddings failed (${res.status}): ${text.slice(0, 300)}`)
          continue
        }
        throw new Error(`OpenRouter embeddings failed (${res.status}): ${text.slice(0, 300)}`)
      }
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] }
      const out: number[][] = new Array(inputs.length)
      for (const d of json.data) out[d.index] = d.embedding
      return out
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('OpenRouter embeddings failed')
}

export async function embedText(input: string): Promise<number[]> {
  const [v] = await embedTexts([input])
  return v
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export async function chatComplete(messages: ChatMessage[], opts?: { json?: boolean; temperature?: number }): Promise<string> {
  const res = await fetchWithTimeout(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: chatModel(),
      messages,
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, 15_000)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter chat failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
}