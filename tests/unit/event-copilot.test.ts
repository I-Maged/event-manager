import { describe, expect, it } from 'vitest';
import {
  draftDescription,
  COPILOT_SYSTEM_PROMPT,
  COPILOT_MAX_TOKENS,
  type CopilotClient,
} from '@/lib/ai/event-copilot';
import type { DraftDescriptionInput } from '@/lib/event-validation';

const input: DraftDescriptionInput = {
  title: 'picnic',
  bullets: ['bring food', 'sunset'],
  category: 'COMMUNITY',
  location: 'park',
  capacityHint: 20,
};

function clientReturning(content: string): CopilotClient {
  return { complete: async () => content };
}

function clientThrowing(err: Error): CopilotClient {
  return { complete: async () => { throw err; } };
}

describe('event copilot', () => {
  it('exports a stable system prompt and token cap', () => {
    expect(typeof COPILOT_SYSTEM_PROMPT).toBe('string');
    expect(COPILOT_MAX_TOKENS).toBe(500);
  });

  it('returns a validated suggestion on valid JSON', async () => {
    const res = await draftDescription(
      input,
      clientReturning(JSON.stringify({ title: 'Sunset Picnic', description: 'Join us.', category: 'COMMUNITY', capacity: 25 })),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.suggestion.title).toBe('Sunset Picnic');
    expect(res.suggestion.capacity).toBe(25);
  });

  it('fails on invalid JSON', async () => {
    const res = await draftDescription(input, clientReturning('not json'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/invalid JSON/i);
    expect(res.raw).toBe('not json');
  });

  it('fails on invalid suggestion', async () => {
    const res = await draftDescription(input, clientReturning(JSON.stringify({ category: 'NOPE' })));
    expect(res.ok).toBe(false);
  });

  it('clamps overlong title and description', async () => {
    const res = await draftDescription(
      input,
      clientReturning(JSON.stringify({ title: 'x'.repeat(250), description: 'y'.repeat(6000) })),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.suggestion.title?.length).toBe(200);
    expect(res.suggestion.description?.length).toBe(5000);
  });

  it('handles client errors', async () => {
    const res = await draftDescription(input, clientThrowing(new Error('boom')));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('boom');
  });
});