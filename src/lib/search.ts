/**
 * Escape PostgreSQL LIKE metacharacters so user input is matched literally.
 * Backslash is the default LIKE escape character; the value is still
 * parameterized, so this only changes matching semantics (a lone `%` no longer
 * matches every row) and avoids the full-scan wildcard.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
