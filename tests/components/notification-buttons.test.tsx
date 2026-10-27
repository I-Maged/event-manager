import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  MarkReadButton,
  MarkAllReadButton,
} from '@/app/notifications/NotificationButtons';

const { mockMarkRead, mockMarkAllRead } = vi.hoisted(() => ({
  mockMarkRead: vi.fn(),
  mockMarkAllRead: vi.fn(),
}));
vi.mock('@/app/notifications/actions', () => ({
  markRead: mockMarkRead,
  markAllRead: mockMarkAllRead,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MarkReadButton', () => {
  it('calls markRead and hides itself on success', async () => {
    mockMarkRead.mockResolvedValue({ ok: true });
    render(<MarkReadButton id="notif_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    });
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
  });

  it('shows an alert when markRead returns {ok:false}', async () => {
    mockMarkRead.mockResolvedValue({ ok: false, error: 'Notification not found.' });
    render(<MarkReadButton id="notif_1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Notification not found.');
    expect(screen.getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockMarkRead.mockReturnValue(
      new Promise((res) => (resolve = res)),
    );
    render(<MarkReadButton id="notif_1" />);
    const btn = screen.getByRole('button', { name: 'Mark read' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Marking…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});

describe('MarkAllReadButton', () => {
  it('calls markAllRead when clicked', async () => {
    mockMarkAllRead.mockResolvedValue({ ok: true });
    render(<MarkAllReadButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('shows an alert when markAllRead returns {ok:false}', async () => {
    mockMarkAllRead.mockResolvedValue({ ok: false, error: 'Failed to mark all read.' });
    render(<MarkAllReadButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to mark all read.');
  });

  it('is disabled when the disabled prop is passed', () => {
    render(<MarkAllReadButton disabled />);
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockMarkAllRead.mockReturnValue(
      new Promise((res) => (resolve = res)),
    );
    render(<MarkAllReadButton />);
    const btn = screen.getByRole('button', { name: 'Mark all read' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getByText('Marking…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(btn).not.toBeDisabled();
  });
});
