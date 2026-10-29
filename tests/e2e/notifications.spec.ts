import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Notifications', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('empty state renders', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText('Nothing yet.')).toBeVisible();
  });

  test('seeded notification renders and mark-all works', async ({ page }) => {
    const roster = readRoster();
    await prisma.notification.create({
      data: {
        userId: roster.organizer.userId,
        type: 'PROMOTION',
        title: 'Factory notification',
        body: 'hello',
      },
    });
    await page.goto('/notifications');
    await expect(page.getByText('Factory notification')).toBeVisible();
    await page.getByRole('button', { name: /mark all read/i }).click();
    await expect(page.getByText('Factory notification')).toBeVisible();
  });
});