import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LeaveWishlistButton } from '@/app/wishlist/WishlistButtons';

const { mockCancelRsvp } = vi.hoisted(() => ({
  mockCancelRsvp: vi.fn(),
}));
vi.mock('@/app/events/actions', () => ({
  cancelRsvp: mockCancelRsvp,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('confirm', vi.fn(() => true));
  mockCancelRsvp.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeaveWishlistButton', () => {
  it('asks for confirmation before calling cancelRsvp', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<LeaveWishlistButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave wishlist' }));
    });
    expect(confirm).toHaveBeenCalledWith('Leave this wishlist?');
    expect(mockCancelRsvp).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the user declines confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<LeaveWishlistButton eventId="evt_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave wishlist' }));
    expect(mockCancelRsvp).not.toHaveBeenCalled();
  });

  it('shows an alert when cancelRsvp returns {ok:false}', async () => {
    mockCancelRsvp.mockResolvedValue({
      ok: false,
      error: 'You have no RSVP to remove.',
    });
    render(<LeaveWishlistButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave wishlist' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('You have no RSVP to remove.');
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockCancelRsvp.mockReturnValue(
      new Promise((res) => (resolve = res)),
    );
    render(<LeaveWishlistButton eventId="evt_1" />);
    const btn = screen.getByRole('button', { name: 'Leave wishlist' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Leaving…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});
