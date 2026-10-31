import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('E2E suite hygiene', () => {
  it('contains no waitForTimeout or focused tests', () => {
    const root = join(process.cwd(), 'tests', 'e2e');
    const violations: string[] = [];
    for (const file of collectFiles(root)) {
      const text = readFileSync(file, 'utf8');
      if (/waitForTimeout/.test(text)) {
        violations.push(`${file}: uses waitForTimeout`);
      }
      if (/\b(?:test|it|describe)\.only\b/.test(text)) {
        violations.push(`${file}: uses a focused test`);
      }
    }
    expect(violations).toEqual([]);
  });
});
