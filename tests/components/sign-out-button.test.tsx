import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SignOutButton } from '@/components/SignOutButton';

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock('@/lib/auth/client', () => ({
  authClient: { signOut: vi.fn() },
}));

import { authClient } from '@/lib/auth/client';

const mockSignOut = vi.mocked(authClient.signOut);

beforeEach(() => {
  vi.clearAllMocks();
  mockSignOut.mockResolvedValue({});
});

function renderSignOut() {
  return render(<SignOutButton />);
}

describe('SignOutButton', () => {
  it('calls authClient.signOut when clicked', async () => {
    renderSignOut();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('pushes / and refreshes on success', async () => {
    renderSignOut();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(mockPush).toHaveBeenCalledWith('/');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback error and does not navigate when signOut throws', async () => {
    mockSignOut.mockRejectedValue(new Error('nope'));
    renderSignOut();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows result.error when signOut returns an error object', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Custom sign out failure' } });
    renderSignOut();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Custom sign out failure');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('is disabled while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockSignOut.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderSignOut();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
    await act(async () => {
      resolve!(undefined);
    });
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeDisabled();
  });
});
