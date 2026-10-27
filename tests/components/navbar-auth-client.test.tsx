import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavbarAuthClient } from '@/components/NavbarAuthClient';
import { authClient } from '@/lib/auth/client';

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    useSession: vi.fn(),
  },
}));

const mockedUseSession = vi.mocked(authClient.useSession);

function renderClient(session: { user: { email: string } } | null, isPending = false) {
  mockedUseSession.mockReturnValue({
    data: session,
    isPending,
  } as never);
  return render(<NavbarAuthClient />);
}

describe('NavbarAuthClient', () => {
  it('renders a loading state while pending', () => {
    renderClient(null, true);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('renders signed-out state with Sign in and Sign up links', () => {
    renderClient(null);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('renders signed-in state with the email and SignOutButton', () => {
    renderClient({ user: { email: 'ada@example.com' } });
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
