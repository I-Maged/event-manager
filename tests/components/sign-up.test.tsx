import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SignUpPage from '@/app/auth/sign-up/page';

const { mockSignUpEmail } = vi.hoisted(() => ({
  mockSignUpEmail: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signUp: { email: mockSignUpEmail },
  },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  return render(<SignUpPage />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSignUpEmail.mockResolvedValue({});
  mockPush.mockClear();
});

describe('Sign up page', () => {
  it('validates required email and password fields', async () => {
    renderPage();
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form!);
    });
    expect(mockSignUpEmail).not.toHaveBeenCalled();
    expect(screen.getByText('Email address must be provided.')).toBeInTheDocument();
  });

  it('enforces minimum password length via the input attribute', () => {
    renderPage();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8');
  });

  it('shows the provider error message on failure', async () => {
    mockSignUpEmail.mockResolvedValue({
      error: { message: 'Email already exists.' },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });
    expect(screen.getByText('Email already exists.')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('pushes / and refreshes on success', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});
