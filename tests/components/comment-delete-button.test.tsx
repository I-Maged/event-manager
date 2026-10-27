import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CommentDeleteButton } from '@/app/events/[id]/comments/CommentDeleteButton';

const { mockDeleteComment } = vi.hoisted(() => ({
  mockDeleteComment: vi.fn(),
}));
vi.mock('@/app/events/[id]/comments/actions', () => ({
  deleteComment: mockDeleteComment,
}));

const mockDelete = vi.mocked(mockDeleteComment);

function renderButton({ commentId = 'comment_1' }: { commentId?: string } = {}) {
  return render(<CommentDeleteButton commentId={commentId} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue({ ok: true });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentDeleteButton', () => {
  it('asks for confirmation before calling the action', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(confirm).toHaveBeenCalledWith('Delete this comment?');
    expect(mockDelete).toHaveBeenCalledWith('comment_1');
  });

  it('does nothing when the user declines confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows an alert when the action returns {ok:false}', async () => {
    mockDelete.mockResolvedValue({ ok: false, error: 'You cannot delete this comment.' });
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You cannot delete this comment.',
    );
  });

  it('shows the generic error when the action throws', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Delete failed. Please retry.');
  });

  it('disables the button while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockDelete.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderButton();
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);
    expect(deleteBtn).toBeDisabled();
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(deleteBtn).not.toBeDisabled();
  });
});
