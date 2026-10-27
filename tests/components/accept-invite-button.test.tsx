import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AcceptInviteButton } from '@/app/invite/[token]/AcceptInviteButton';

const { mockAcceptInvite } = vi.hoisted(() => ({
  mockAcceptInvite: vi.fn(),
}));
vi.mock('@/app/events/actions', () => ({
  acceptInvite: mockAcceptInvite,
}));
vi.mock('next/link', () => {
  const Link = ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a data-testid="nav-link" href={href} {...props}>
      {children}
    </a>
  );
  return { default: Link };
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('AcceptInviteButton', () => {
  it('calls acceptInvite and shows the joined message on success', async () => {
    mockAcceptInvite.mockResolvedValue({
      ok: true,
      status: 'GOING',
      waitlistPosition: null,
      eventId: 'evt_1',
    });
    render(<AcceptInviteButton token="tok_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Accept invite/ }));
    });
    expect(mockAcceptInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/You're in!/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View event' })).toBeInTheDocument();
  });

  it('shows the wishlist position message when accepted as WAITLISTED', async () => {
    mockAcceptInvite.mockResolvedValue({
      ok: true,
      status: 'WAITLISTED',
      waitlistPosition: 3,
      eventId: 'evt_1',
    });
    render(<AcceptInviteButton token="tok_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Accept invite/ }));
    });
    expect(screen.getByText(/#3 on the wishlist/)).toBeInTheDocument();
  });

  it('shows the error alert when acceptInvite returns {ok:false}', async () => {
    mockAcceptInvite.mockResolvedValue({
      ok: false,
      error: 'Invalid invite link.',
    });
    render(<AcceptInviteButton token="tok_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Accept invite/ }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid invite link.');
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockAcceptInvite.mockReturnValue(
      new Promise((res) => (resolve = res)),
    );
    render(<AcceptInviteButton token="tok_1" />);
    const btn = screen.getByRole('button', { name: /Accept invite/ });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Joining…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});
