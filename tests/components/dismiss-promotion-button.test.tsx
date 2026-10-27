import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DismissPromotionButton } from '@/app/wishlist/WishlistButtons';

const { mockDismissPromotion } = vi.hoisted(() => ({
  mockDismissPromotion: vi.fn(),
}));
vi.mock('@/app/events/actions', () => ({
  dismissPromotion: mockDismissPromotion,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('DismissPromotionButton', () => {
  it('calls dismissPromotion and hides itself on success', async () => {
    mockDismissPromotion.mockResolvedValue({ ok: true });
    render(<DismissPromotionButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });
    expect(mockDismissPromotion).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('shows an alert when dismissPromotion returns {ok:false}', async () => {
    mockDismissPromotion.mockResolvedValue({ ok: false, error: 'Not promoted.' });
    render(<DismissPromotionButton eventId="evt_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Not promoted.');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockDismissPromotion.mockReturnValue(
      new Promise((res) => (resolve = res)),
    );
    render(<DismissPromotionButton eventId="evt_1" />);
    const btn = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Dismissing…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});
