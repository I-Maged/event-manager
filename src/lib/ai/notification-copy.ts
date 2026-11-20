import { chatComplete } from '@/lib/ai/gateway';

export type NotificationKind =
  | 'PROMOTION'
  | 'EVENT_UPDATED'
  | 'EVENT_CANCELLED'
  | 'COMMENT'
  | 'REMINDER';

export type NotificationCopyEvent = {
  title: string;
  category?: string | null;
  description?: string | null;
  location?: string | null;
  date?: Date | null;
  timeZone?: string | null;
};

export type NotificationCopyInput = {
  kind: NotificationKind;
  event: NotificationCopyEvent;
  changeLines?: string[];
  commentSnippet?: string;
};

export type NotificationCopy = { title: string; body: string };

export type NotificationCopyClient = {
  complete: (system: string, user: string) => Promise<string>;
};

const defaultClient: NotificationCopyClient = {
  complete: async (system, user) =>
    chatComplete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0.4 },
    ),
};

export const NOTIFICATION_COPY_SYSTEM_PROMPT = `You write short in-app notification copy for an event platform.
Return ONLY a valid JSON object: {"title": string, "body": string}.
- title <= 80 characters, body <= 200 characters.
- Tone should match the event category (e.g. TECH professional and concise, MUSIC energetic and warm, WELLNESS calm and reassuring, COMMUNITY warm and inclusive, BUSINESS formal, ARTS creative, SPORTS energetic, FOOD appetizing, EDUCATION informative, OTHER friendly).
- Be specific: include the event title and logistics (date/time/location) when provided.
- For EVENT_UPDATED, reflect what changed.
- For EVENT_CANCELLED, be empathetic and clear.
- For PROMOTION, be celebratory but concise.
- For COMMENT, acknowledge the new discussion.
- No markdown, no code fences, no emojis unless natural.
- Never invent facts not present in the input.`;

export function buildNotificationCopyUser(input: NotificationCopyInput): string {
  const e = input.event;
  const lines: string[] = [];
  lines.push(`Kind: ${input.kind}`);
  lines.push(`Event title: ${e.title}`);
  if (e.category) lines.push(`Category: ${e.category}`);
  if (e.description) lines.push(`Description: ${e.description.slice(0, 400)}`);
  if (e.date) lines.push(`When: ${e.date.toISOString()} (${e.timeZone ?? 'UTC'})`);
  if (e.location) lines.push(`Where: ${e.location}`);
  if (input.changeLines && input.changeLines.length > 0) {
    lines.push('Changes:');
    for (const cl of input.changeLines) lines.push(`- ${cl}`);
  }
  if (input.commentSnippet) {
    lines.push(`Comment: ${input.commentSnippet.slice(0, 200)}`);
  }
  return lines.join('\n');
}

export function parseNotificationCopy(raw: string): NotificationCopy | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const body = typeof obj.body === 'string' ? obj.body.trim() : '';
  if (!title || !body) return null;
  return { title: title.slice(0, 80), body: body.slice(0, 200) };
}

/**
 * Generate personalized notification copy. Returns null on any failure so
 * callers can fall back to templates. Never throws.
 */
export async function generateNotificationCopy(
  input: NotificationCopyInput,
  client?: NotificationCopyClient,
  timeoutMs = 3000,
): Promise<NotificationCopy | null> {
  // Injected clients (tests) always run; default path skips under Vitest to
  // keep DB/integration tests deterministic and network-free.
  const useClient = client ?? (process.env.VITEST ? null : defaultClient);
  if (!useClient) return null;

  const user = buildNotificationCopyUser(input);
  try {
    const raw = await Promise.race([
      useClient.complete(NOTIFICATION_COPY_SYSTEM_PROMPT, user),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('notification copy timeout')), timeoutMs),
      ),
    ]);
    return parseNotificationCopy(raw);
  } catch {
    return null;
  }
}