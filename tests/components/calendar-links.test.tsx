import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarLinks } from '@/components/CalendarLinks';

const event = {
  id: 'evt_1',
  title: 'Jazz & Blues, Live',
  description: 'Line one',
  location: 'Berlin Hall',
  date: new Date('2026-10-20T18:00:00Z'),
};

describe('CalendarLinks', () => {
  it('renders an ICS link and a Google Calendar link', () => {
    render(<CalendarLinks event={event} />);
    expect(
      screen.getByRole('link', { name: 'Download .ics' }),
    ).toHaveAttribute('href', '/api/events/evt_1/calendar');
    expect(screen.getByRole('link', { name: 'Add to Google' })).toHaveAttribute(
      'href',
      expect.stringContaining('calendar.google.com'),
    );
  });
});
