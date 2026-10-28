import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl } from './helpers/server';
import { request } from './helpers/client';
import { clearSession, adoptRosterUser } from './helpers/auth';
import { resetDomainTables } from '../support/db';
import { makeEvent, uniqueId } from '../support/factories';

beforeEach(async () => {
  clearSession();
  await resetDomainTables();
});

const SECURITY_HEADERS = [
  'Strict-Transport-Security',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Content-Security-Policy-Report-Only',
];

const TEST_ROUTES = ['/', '/events', '/auth/sign-in', '/auth/sign-up'];

function expectSecurityHeaders(headers: Headers, label: string): void {
  for (const header of SECURITY_HEADERS) {
    expect(headers.get(header), `${label}: ${header}`).not.toBeNull();
  }
  expect(headers.get('Strict-Transport-Security')).toContain(
    'max-age=63072000',
  );
  expect(headers.get('Strict-Transport-Security')).toContain(
    'includeSubDomains',
  );
  expect(headers.get('X-Frame-Options')).toBe('DENY');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(
    headers.get('Content-Security-Policy-Report-Only'),
  ).toContain("default-src 'self'");
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
}

describe('Headers and security (4.4)', () => {
  it('all security headers present on every route', async () => {
    for (const route of TEST_ROUTES) {
      const res = await request(`${baseUrl}${route}`);
      expectSecurityHeaders(res.headers, route);
    }
  });

  it('all security headers present on protected redirects and API routes', async () => {
    const redirect = await request(`${baseUrl}/my-events`, {
      redirect: 'manual',
    });
    expect(redirect.status).toBe(307);
    expectSecurityHeaders(redirect.headers, '/my-events (307)');

    const api = await request(`${baseUrl}/api/auth/get-session`);
    expect(api.status).toBe(200);
    expectSecurityHeaders(api.headers, '/api/auth/get-session');
  });

  it('private event HTML never contains the private title for an outsider', async () => {
    const event = await makeEvent({
      isPublic: false,
      title: 'Secret Board Meeting',
      userId: uniqueId('owner'),
    });
    const res = await request(`${baseUrl}/events/${event.id}`);
    const html = await res.text();

    // Next 16 streams the page, so `notFound()` renders after the headers are
    // sent: the status is 200, but the body is the generic not-found page.
    expect(html).not.toContain('Secret Board Meeting');
    expect(html).not.toContain('Secret');
    expect(html).not.toContain('Meeting');
    expect(html).toContain('Event not found');
  });

  it('private event metadata uses the not-found title for an outsider', async () => {
    const event = await makeEvent({
      isPublic: false,
      title: 'Secret Board Meeting',
      userId: uniqueId('owner'),
    });
    const res = await request(`${baseUrl}/events/${event.id}`);
    const html = await res.text();
    const title = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? '';
    expect(title).toContain('Event not found');
    expect(title).not.toContain('Secret Board Meeting');
  });

  it('private API 404/401 responses do not disclose the private title', async () => {
    const event = await makeEvent({
      isPublic: false,
      title: 'Secret Board Meeting',
      userId: uniqueId('owner'),
    });

    const calendar = await request(
      `${baseUrl}/api/events/${event.id}/calendar`,
    );
    expect(calendar.status).toBe(404);
    const calendarBody = await calendar.text();
    expect(calendarBody).not.toContain('Secret Board Meeting');

    const attendees = await request(
      `${baseUrl}/api/events/${event.id}/attendees`,
    );
    expect(attendees.status).toBe(401);
    expect(await attendees.text()).not.toContain('Secret Board Meeting');
  });

  it('per-user pages are private and no-store', async () => {
    adoptRosterUser('organizer');
    for (const route of ['/my-events', '/notifications', '/wishlist']) {
      const res = await request(`${baseUrl}${route}`, { redirect: 'manual' });
      expect(res.status, route).toBe(200);
      const cacheControl = res.headers.get('Cache-Control') ?? '';
      expect(cacheControl, route).toMatch(/private|no-store/);
    }
  });
});
