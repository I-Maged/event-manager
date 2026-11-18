import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rerankEnabled } from '@/lib/ai/rerank'

describe('rerankEnabled', () => {
  const orig = process.env.AI_RERANK_ENABLED
  afterEach(() => {
    if (orig === undefined) delete process.env.AI_RERANK_ENABLED
    else process.env.AI_RERANK_ENABLED = orig
  })
  it('defaults on', () => {
    delete process.env.AI_RERANK_ENABLED
    expect(rerankEnabled()).toBe(true)
  })
  it('can be disabled', () => {
    process.env.AI_RERANK_ENABLED = 'false'
    expect(rerankEnabled()).toBe(false)
  })
})