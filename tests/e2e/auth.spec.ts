import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedNotification } from './support/db';
import { newRolePage } from './support/context';

test.describe('Auth', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('home page renders a heading @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  const protectedRoutes = [
    '/account',
    '/events/new',
    '/wishlist',
    '/my-events',
    '/notifications',
  ];

  test('signed-out users are redirected from protected routes @smoke', async ({ page }) => {
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

  test('valid sign-in lands on home @smoke', async ({ page }) => {
    const roster = readRoster();
    await page.goto('/auth/sign-in');
    await page.getByLabel('Email address').fill(roster.organizer.email);
    await page.getByLabel('Password').fill(roster.organizer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('callback URL round-trips after sign-in @smoke', async ({ page }) => {
    const roster = readRoster();
    await page.goto('/wishlist');
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fwishlist/);
    await page.getByLabel('Email address').fill(roster.organizer.email);
    await page.getByLabel('Password').fill(roster.organizer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/wishlist/);
  });

  test('callback URL preserves invite token', async ({ page }) => {
    const roster = readRoster();
    const token = `wave1-invite-${Date.now()}`;
    await prisma.event.create({
      data: {
        title: 'Invite callback event',
        description: 'desc',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        isPublic: false,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
        inviteToken: token,
      },
    });
    await page.goto(`/invite/${token}`);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`next=%2Finvite%2F${token}`));
  });

  test('session expiry on RSVP shows no error banner', async ({ page, context }) => {
    const { seedEvent } = await import('./support/db');
    const roster = readRoster();
    const event = await seedEvent({
      title: 'RSVP expiry event',
      userId: roster.organizer.userId,
      organizerName: 'Org',
    });

    await page.goto(`/events/${event.id}`);
    await context.clearCookies();
    const going = page.getByRole('button', { name: /^Going$/i }).first();
    if (await going.isVisible()) {
      await going.click();
      await expect(page).toHaveURL(/\/auth\/sign-in/);
      await expect(page.locator('.alert-error, [role="alert"]')).toHaveCount(0);
    }
  });
});

test.describe('Auth sign-up', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('sign-up validates required email and password @smoke', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await page.getByLabel('Email address').fill('');
    await page.getByLabel('Password').fill('');
    await page.getByRole('button', { name: 'Create Account' }).click();
    // The form is still on the sign-up page and shows the client error.
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });

  test('sign-up with a short password stays on the form', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await page.getByLabel('Name').fill('Short Password User');
    await page.getByLabel('Email address').fill(`short-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });

  test('sign-up duplicate email shows an error', async ({ page }) => {
    const email = `duplicate-${Date.now()}@example.com`;
    await page.goto('/auth/sign-up');
    await page.getByLabel('Name').fill('First User');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('Secret1234!');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/auth/sign-up');
    await page.getByLabel('Name').fill('Second User');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('Secret1234!');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
  });
});

test.describe('Auth signed-in navbar', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('signed-in navbar links include account surfaces @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My events' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wishlist' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Notifications, no unread/ })).toBeVisible();
  });

  test('unread bell label updates after seeding a notification', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'Bell notification' });
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /Notifications, 1 unread/ }),
    ).toBeVisible();
  });

  /**
   * F1 guard: with the session-data cache cookie gone (expired cache), the
   * render must refresh the session through the guarded writer instead of
   * failing with `Cookies can only be modified in a Server Action or Route
   * Handler` and showing the error boundary. The SDK-level reproduction lives
   * in `tests/unit/auth-session-render.test.ts`.
   */
  test('an expired session cache still renders signed-in pages', async ({
    browser,
  }) => {
    const { context, page } = await newRolePage(browser, 'organizer');
    try {
      const roster = readRoster();
      const cookies = await context.cookies();
      expect(cookies.some((c) => c.name.endsWith('session_data'))).toBe(true);

      await context.clearCookies();
      await context.addCookies(
        cookies.filter((c) => !c.name.endsWith('session_data')),
      );

      await page.goto('/account');
      await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
      // The email is in both the navbar and the account row; scope to the row.
      await expect(
        page
          .getByRole('definition')
          .filter({ hasText: roster.organizer.email }),
      ).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('sign-out clears the session @smoke', async ({ page }) => {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

});

test.describe('Auth security', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test('open redirect is not honored', async ({ page }) => {
    const roster = readRoster();
    await page.goto('/auth/sign-in?next=//evil.example');
    await page.getByLabel('Email address').fill(roster.organizer.email);
    await page.getByLabel('Password').fill(roster.organizer.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL(/evil\.example/);
  });
});
