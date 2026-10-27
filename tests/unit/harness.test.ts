import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '@/lib/search';

describe('unit harness', () => {
  it('resolves the @/* alias', () => {
    expect(escapeLikePattern('%_')).toBe('\\%\\_');
  });

  it('pins the documented app time zone', () => {
    expect(process.env.APP_TIME_ZONE).toBe('Europe/Berlin');
  });
});
