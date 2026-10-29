import { readRoster } from './fixtures';
import { prisma } from './db';

export async function seedComments(
  eventId: string,
  count: number,
  userId: string,
  authorName = 'Seeded commenter',
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await prisma.comment.create({
      data: {
        eventId,
        userId,
        authorName,
        body: `Seeded comment ${i + 1}`,
      },
    });
  }
}

export async function seedNotifications(
  userId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'PROMOTION',
        title: `Seeded notification ${i + 1}`,
        body: 'hello',
        eventId: null,
      },
    });
  }
}

export async function seedRosterEvent(
  title = 'Wave 1 event',
): Promise<{ organizerId: string; eventId: string }> {
  const roster = readRoster();
  const event = await prisma.event.create({
    data: {
      title,
      description: 'Factory-created test event.',
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      timeZone: 'Europe/Berlin',
      location: 'Test venue',
      maxAttendees: null,
      isPublic: true,
      category: 'OTHER',
      userId: roster.organizer.userId,
      organizerName: 'Org',
    },
  });
  return { organizerId: roster.organizer.userId, eventId: event.id };
}
