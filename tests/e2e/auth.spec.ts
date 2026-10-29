import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { resetDomainTables } from './support/db';
import { readRoster } from './support/fixtures';

test.describe('Auth', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('home page renders a heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  const protectedRoutes = [
    '/events/new',
    '/wishlist',
    '/my-events',
    '/notifications',
  ];

  test('signed-out users are redirected from protected routes', async ({ page }) => {
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/sign-in/);
    }
  });

  test('invalid password shows an error', async ({ page }) => {
    const roster = readRoster();
    await page.goto('/auth/sign-in');
    await page.getByLabel('Email address').fill(roster.outsider.email);
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
  });

  test('callback URL round-trips after sign-in', async ({ page }) => {
    const roster = readRoster();
    await page.goto('/wishlist');
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fwishlist/);
    await page.getByLabel('Email address').fill(roster.organizer.email);
    await page.getByLabel('Password').fill(roster.organizer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/wishlist/);
  });

  test('session expiry on RSVP shows no error banner', async ({ page, context }) => {
    // Seed a public upcoming event directly.
    const { prisma } = await import('./support/db');
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: 'RSVP expiry event',
        description: 'desc',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        isPublic: true,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
      },
    });

    await page.goto(`/events/${event.id}`);
    // Clear cookies to simulate expiry, then attempt RSVP.
    await context.clearCookies();
    const going = page.getByRole('button', { name: /^Going$/i }).first();
    if (await going.isVisible()) {
      await going.click();
      await expect(page).toHaveURL(/\/auth\/sign-in/);
      await expect(page.locator('.alert-error, [role="alert"]')).toHaveCount(0);
    }
  });
});