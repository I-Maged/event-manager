import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DeleteEventButton } from '@/app/events/[id]/edit/DeleteEventButton';

const { mockDeleteEvent } = vi.hoisted(() => ({
  mockDeleteEvent: vi.fn(),
}));
vi.mock('@/app/events/[id]/edit/actions', () => ({
  deleteEvent: mockDeleteEvent,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('confirm', vi.fn(() => true));
  mockDeleteEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeleteEventButton', () => {
  it('asks for confirmation before calling the action', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<DeleteEventButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    });
    expect(confirm).toHaveBeenCalledWith(
      'Delete this event and all its RSVPs?',
    );
    expect(mockDeleteEvent).toHaveBeenCalledTimes(1);
  });

  it('does not call the action when the user declines confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<DeleteEventButton eventId="evt_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });

  it('shows an alert when deleteEvent throws', async () => {
    mockDeleteEvent.mockRejectedValue(new Error('Deletion failed.'));
    render(<DeleteEventButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Please retry.',
    );
  });
});
