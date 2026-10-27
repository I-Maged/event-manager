import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptInviteCore,
  createInviteLinkCore,
  regenerateInviteLinkCore,
  revokeInviteLinkCore,
} from '@/lib/invite';
import { getEventByInviteToken, getInviteToken } from '@/lib/events';
import { prisma, resetDomainTables } from '../support/db';
import { makeEvent, makeRsvp, uniqueId } from '../support/factories';

describe('Invite links', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('create on a private event returns a token', async () => {
    const event = await makeEvent({ isPublic: false });
    const result = await createInviteLinkCore(event.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toMatch(/^[0-9a-f]{32}$/);
      const stored = await getInviteToken(event.id);
      expect(stored).toBe(result.token);
    }
  });

  it('create is idempotent and returns the existing token', async () => {
    const event = await makeEvent({ isPublic: false });
    const first = await createInviteLinkCore(event.id);
    expect(first.ok).toBe(true);
    const second = await createInviteLinkCore(event.id);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.token).toBe(first.token);
    }
  });

  it('two concurrent creates return the same token', async () => {
    const event = await makeEvent({ isPublic: false });
    const results = await Promise.all([
      createInviteLinkCore(event.id),
      createInviteLinkCore(event.id),
    ]);
    const tokens = results.map((r) => (r.ok ? r.token : null));
    expect(tokens.every((t) => t !== null)).toBe(true);
    expect(tokens[0]).toBe(tokens[1]);
  });

  it('public events reject invite creation', async () => {
    const event = await makeEvent({ isPublic: true });
    const result = await createInviteLinkCore(event.id);
    expect(result).toEqual({
      ok: false,
      error: 'Public events do not need invite links.',
    });
  });

  it('regenerate replaces the token', async () => {
    const event = await makeEvent({ isPublic: false });
    const first = await createInviteLinkCore(event.id);
    expect(first.ok).toBe(true);
    const second = await regenerateInviteLinkCore(event.id);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.token).not.toBe(first.token);
      const stored = await getInviteToken(event.id);
      expect(stored).toBe(second.token);
    }
  });

  it('old token no longer resolves after regeneration', async () => {
    const event = await makeEvent({ isPublic: false });
    const first = await createInviteLinkCore(event.id);
    expect(first.ok).toBe(true);
    await regenerateInviteLinkCore(event.id);
    const resolved = await getEventByInviteToken(first.ok ? first.token : '');
    expect(resolved).toBeNull();
  });

  it('revoke clears the token', async () => {
    const event = await makeEvent({ isPublic: false });
    await createInviteLinkCore(event.id);
    const result = await revokeInviteLinkCore(event.id);
    expect(result.ok).toBe(true);
    const stored = await getInviteToken(event.id);
    expect(stored).toBeNull();
  });

  it('revoked token no longer resolves', async () => {
    const event = await makeEvent({ isPublic: false });
    const created = await createInviteLinkCore(event.id);
    expect(created.ok).toBe(true);
    await revokeInviteLinkCore(event.id);
    const resolved = await getEventByInviteToken(created.ok ? created.token : '');
    expect(resolved).toBeNull();
  });

  it('unknown event is handled', async () => {
    const created = await createInviteLinkCore('does-not-exist');
    expect(created).toEqual({ ok: false, error: 'Event not found.' });
    const regenerated = await regenerateInviteLinkCore('does-not-exist');
    expect(regenerated).toEqual({ ok: false, error: 'Event not found.' });
    const revoked = await revokeInviteLinkCore('does-not-exist');
    expect(revoked.ok).toBe(false);
  });

  it('accept creates GOING when space is available', async () => {
    const event = await makeEvent({ isPublic: false, maxAttendees: 2 });
    const created = await createInviteLinkCore(event.id);
    expect(created.ok).toBe(true);
    const attendee = uniqueId('attendee');
    const result = await acceptInviteCore(attendee, 'Ada', created.ok ? created.token : '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rsvp.status).toBe('GOING');
      const row = await prisma.rSVP.findUnique({
        where: { userId_eventId: { userId: attendee, eventId: event.id } },
      });
      expect(row?.attendeeName).toBe('Ada');
    }
  });

  it('accept creates WAITLISTED when full', async () => {
    const event = await makeEvent({ isPublic: false, maxAttendees: 1 });
    await makeRsvp({ eventId: event.id, userId: uniqueId('holder'), status: 'GOING' });
    const created = await createInviteLinkCore(event.id);
    expect(created.ok).toBe(true);
    const attendee = uniqueId('attendee');
    const result = await acceptInviteCore(attendee, 'Ada', created.ok ? created.token : '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rsvp.status).toBe('WAITLISTED');
  });

  it('accept on an ended event is rejected', async () => {
    const event = await makeEvent({ isPublic: false, date: new Date(Date.now() - 60_000) });
    const created = await createInviteLinkCore(event.id);
    expect(created.ok).toBe(true);
    const result = await acceptInviteCore(
      uniqueId('attendee'),
      'Ada',
      created.ok ? created.token : '',
    );
    expect(result).toEqual({ ok: false, error: 'This event has ended.' });
  });

  it('accept by the host is rejected', async () => {
    const event = await makeEvent({ isPublic: false });
    const created = await createInviteLinkCore(event.id);
    expect(created.ok).toBe(true);
    const result = await acceptInviteCore(
      event.userId,
      'Ada',
      created.ok ? created.token : '',
    );
    expect(result).toEqual({
      ok: false,
      error: 'You are hosting this event.',
      eventId: event.id,
    });
  });

  it('accept with an unknown token is rejected', async () => {
    const result = await acceptInviteCore(uniqueId('attendee'), 'Ada', 'unknown-token');
    expect(result).toEqual({
      ok: false,
      error: 'This invite link is invalid or revoked.',
    });
  });
});
