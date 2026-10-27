import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RsvpControls } from '@/components/RsvpControls';
import type { RSVPStatus } from '@/generated/prisma';

process.on('unhandledRejection', () => {});

const { mockSetRsvp, mockJoinWishlist, mockCancelRsvp, mockDismissPromotion, mockSetNotifyOnUpdate } =
  vi.hoisted(() => ({
    mockSetRsvp: vi.fn(),
    mockJoinWishlist: vi.fn(),
    mockCancelRsvp: vi.fn(),
    mockDismissPromotion: vi.fn(),
    mockSetNotifyOnUpdate: vi.fn(),
  }));

vi.mock('@/app/events/actions', () => ({
  setRsvp: mockSetRsvp,
  joinWishlist: mockJoinWishlist,
  cancelRsvp: mockCancelRsvp,
  dismissPromotion: mockDismissPromotion,
  setNotifyOnUpdate: mockSetNotifyOnUpdate,
  SettableStatus: undefined,
}));

const baseProps = {
  eventId: 'evt_1',
  currentStatus: null as RSVPStatus | null,
  isPast: false,
  isFull: false,
  isCapped: true,
  waitlistPosition: null as number | null,
  wasPromoted: false,
  initialNotifyOnUpdate: false,
};

function renderControls(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides };
  return render(<RsvpControls {...props} />);
}

function ok(status: RSVPStatus, waitlistPosition: number | null = null) {
  return { ok: true, status, waitlistPosition };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetRsvp.mockResolvedValue(ok('GOING'));
  mockJoinWishlist.mockResolvedValue(ok('WAITLISTED', 1));
  mockCancelRsvp.mockResolvedValue({ ok: true });
  mockDismissPromotion.mockResolvedValue({ ok: true });
  mockSetNotifyOnUpdate.mockResolvedValue({ ok: true });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RsvpControls', () => {
  it('renders the ended state for a past event', () => {
    renderControls({ isPast: true });
    expect(screen.getByText('This event has ended.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Going' })).not.toBeInTheDocument();
  });

  it('reflects the current status with aria-pressed', () => {
    renderControls({ currentStatus: 'GOING' });
    expect(screen.getByRole('button', { name: 'Going' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls setRsvp with GOING when Going is clicked', async () => {
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    });
    expect(mockSetRsvp).toHaveBeenCalledWith('evt_1', 'GOING');
  });

  it('calls setRsvp with MAYBE when Maybe is clicked', async () => {
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    });
    expect(mockSetRsvp).toHaveBeenCalledWith('evt_1', 'MAYBE');
  });

  it('calls setRsvp with NOT_GOING when Can\'t go is clicked', async () => {
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "Can't go" }));
    });
    expect(mockSetRsvp).toHaveBeenCalledWith('evt_1', 'NOT_GOING');
  });

  it('shows the wishlist CTA for a full event with no RSVP', () => {
    renderControls({ isFull: true, isCapped: true, currentStatus: null });
    expect(screen.getByRole('button', { name: 'Join wishlist' })).toBeInTheDocument();
  });

  it('calls joinWishlist when the wishlist CTA is clicked', async () => {
    renderControls({ isFull: true, isCapped: true, currentStatus: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join wishlist' }));
    });
    expect(mockJoinWishlist).toHaveBeenCalledWith('evt_1');
  });

  it('shows a warning instead of the CTA when full and a status exists', () => {
    renderControls({ isFull: true, isCapped: true, currentStatus: 'MAYBE' });
    expect(screen.queryByRole('button', { name: 'Join wishlist' })).not.toBeInTheDocument();
    expect(screen.getByText(/full — choosing/)).toBeInTheDocument();
  });

  it('shows the waitlist position for a WAITLISTED row', () => {
    renderControls({ currentStatus: 'WAITLISTED', waitlistPosition: 3 });
    expect(screen.getByText(/#3/)).toBeInTheDocument();
  });

  it('shows the position message after a successful wishlist join', async () => {
    mockJoinWishlist.mockResolvedValue(ok('WAITLISTED', 2));
    renderControls({ isFull: true, isCapped: true, currentStatus: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join wishlist' }));
    });
    expect(screen.getByText(/#2 on the wishlist/)).toBeInTheDocument();
  });

  it('shows the promoted banner for a promoted GOING row', () => {
    renderControls({ currentStatus: 'GOING', wasPromoted: true });
    expect(screen.getByText(/You got in!/)).toBeInTheDocument();
  });

  it('calls dismissPromotion and hides the banner on dismiss', async () => {
    renderControls({ currentStatus: 'GOING', wasPromoted: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });
    expect(mockDismissPromotion).toHaveBeenCalledWith('evt_1');
    expect(screen.queryByText(/You got in!/)).not.toBeInTheDocument();
  });

  it('shows an alert for an action {ok:false}', async () => {
    mockSetRsvp.mockResolvedValue({ ok: false, error: 'No seats left.' });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('No seats left.');
  });

  it('shows the generic error for a thrown action', async () => {
    mockSetRsvp.mockRejectedValue(new Error('boom'));
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Something went wrong/,
    );
  });

  it('clears pending after a rejection (no stuck buttons)', async () => {
    mockSetRsvp.mockResolvedValue({ ok: false, error: 'No seats left.' });
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    });
    expect(screen.getByRole('button', { name: 'Going' })).not.toBeDisabled();
  });

  it('rethows a framework redirect digest instead of showing an error', async () => {
    mockSetRsvp.mockRejectedValue(
      Object.assign(new Error('redirect'), {
        digest: 'NEXT_REDIRECT;replace;/auth/sign-in;307;',
      }),
    );
    renderControls();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Going' })).not.toBeDisabled();
  });

  it('updates the notify checkbox optimistically', async () => {
    renderControls({ currentStatus: 'GOING', initialNotifyOnUpdate: false });
    fireEvent.click(screen.getByLabelText('Notify me about updates and reminders'));
    expect(screen.getByLabelText('Notify me about updates and reminders')).toBeChecked();
  });

  it('reverts the notify checkbox when the action fails', async () => {
    mockSetNotifyOnUpdate.mockResolvedValue({ ok: false, error: 'nope' });
    renderControls({ currentStatus: 'GOING', initialNotifyOnUpdate: false });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Notify me about updates and reminders'));
    });
    expect(screen.getByLabelText('Notify me about updates and reminders')).not.toBeChecked();
  });

  it('does nothing on cancel decline', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderControls({ currentStatus: 'GOING' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove RSVP' }));
    expect(mockCancelRsvp).not.toHaveBeenCalled();
  });

  it('clears status/position/promotion on cancel success', async () => {
    renderControls({ currentStatus: 'GOING', wasPromoted: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove RSVP' }));
    });
    expect(mockCancelRsvp).toHaveBeenCalledWith('evt_1');
    expect(screen.queryByRole('button', { name: 'Remove RSVP' })).not.toBeInTheDocument();
  });

  it('shows pending labels for each in-flight operation', async () => {
    let resolveSet!: () => void;
    mockSetRsvp.mockImplementation(
      () => new Promise((resolve) => (resolveSet = () => resolve(ok('GOING')))),
    );
    renderControls();
    const goingBtn = screen.getByRole('button', { name: 'Going' });
    await act(async () => {
      fireEvent.click(goingBtn);
    });
    expect(goingBtn).toHaveTextContent(/Saving/);
    await act(async () => {
      resolveSet!();
    });
    expect(goingBtn).toHaveTextContent('Going');
  });
});
