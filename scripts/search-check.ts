/**
 * Search/discovery probe — read-only, safe on any branch.
 *
 *   npx tsx scripts/search-check.ts
 *
 * Verifies LIKE-wildcard escaping and the organizer parameter bound. Exit code
 * 0 = all assertions held, 1 = at least one broke.
 */
import assert from 'node:assert/strict';
import {
  MAX_ORGANIZER_LENGTH,
  parseEventListParams,
} from '@/lib/discovery';
import { escapeLikePattern } from '@/lib/search';

assert.equal(escapeLikePattern('100%'), '100\\%');
assert.equal(escapeLikePattern('a_b'), 'a\\_b');
assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');
assert.equal(escapeLikePattern('plain text'), 'plain text');

const longOrganizer = 'x'.repeat(MAX_ORGANIZER_LENGTH + 50);
const parsed = parseEventListParams({ organizer: longOrganizer });
assert.equal(parsed.organizer?.length, MAX_ORGANIZER_LENGTH);

const blankOrganizer = parseEventListParams({ organizer: '   ' });
assert.equal(blankOrganizer.organizer, null);

console.log('Search probe: all assertions held.');
