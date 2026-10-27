import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '@/lib/search';

/** Ported from `scripts/search-check.ts`, plus the literal-match contract. */
describe('escapeLikePattern', () => {
  it('escapes LIKE metacharacters exactly once', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
    expect(escapeLikePattern('\\\\%')).toBe('\\\\\\\\\\%');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeLikePattern('plain text')).toBe('plain text');
    expect(escapeLikePattern('Café — München 2026')).toBe('Café — München 2026');
    expect(escapeLikePattern('')).toBe('');
  });

  it('produces a pattern that matches the input literally', () => {
    const inputs = ['%', '_', '\\', 'a%b_c', '100% sure?', 'x\\y%z'];
    for (const input of inputs) {
      const escaped = escapeLikePattern(input);
      // Un-escaping the pattern must recover the original text, which is what
      // Postgres LIKE does when the backslash escape character is in effect.
      expect(escaped.replace(/\\(.)/g, '$1'), input).toBe(input);
    }
  });
});
