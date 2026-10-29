import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const violations = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  if (violations.length > 0) {
    throw new Error(
      `Axe serious/critical violations: ${violations
        .map((v) => `${v.id} - ${v.description}`)
        .join('; ')}`,
    );
  }
  return results;
}