import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SignInPage from '@/app/auth/sign-in/page';

const { mockSignInEmail } = vi.hoisted(() => ({
  mockSignInEmail: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: { email: mockSignInEmail },
  },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  return render(<SignInPage />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSignInEmail.mockResolvedValue({});
  mockPush.mockClear();
});

describe('Sign in page', () => {
  it('requires email and password before submitting', async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  it('shows the provider error message on failure', async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: 'Invalid email or password.' },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('disables submit while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockSignInEmail.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderPage();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    const submitBtn = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText('Signing in...')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(submitBtn).not.toBeDisabled();
  });

  it('pushes / and refreshes on success', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});
