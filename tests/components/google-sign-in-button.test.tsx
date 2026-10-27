import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

const { mockSignInSocial } = vi.hoisted(() => ({
  mockSignInSocial: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: { social: mockSignInSocial },
  },
}));

const mockSocial = vi.mocked(mockSignInSocial);

function renderButton({ label = 'Sign in with Google' }: { label?: string } = {}) {
  return render(<GoogleSignInButton label={label} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSocial.mockResolvedValue({});
});

describe('GoogleSignInButton', () => {
  it('renders the expected label', () => {
    renderButton({ label: 'Continue with Google' });
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('calls the Google provider when clicked', async () => {
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    });
    expect(mockSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/account',
    });
  });

  it('shows the provider error message on failure', async () => {
    mockSocial.mockResolvedValue({
      error: { message: 'Google sign-in failed. Is Google enabled in Neon Auth?' },
    });
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    });
    expect(screen.getByText(/Google sign-in failed/)).toBeInTheDocument();
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockSocial.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderButton();
    const btn = screen.getByRole('button', { name: 'Sign in with Google' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Redirecting to Google...')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});
