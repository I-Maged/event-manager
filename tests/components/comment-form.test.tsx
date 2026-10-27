import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CommentForm } from '@/app/events/[id]/comments/CommentForm';

const { mockAddComment } = vi.hoisted(() => ({
  mockAddComment: vi.fn(),
}));
vi.mock('@/app/events/[id]/comments/actions', () => ({
  addComment: mockAddComment,
}));

const mockAdd = vi.mocked(mockAddComment);

function renderForm({ eventId = 'evt_1' }: { eventId?: string } = {}) {
  return render(<CommentForm eventId={eventId} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdd.mockResolvedValue({ ok: true, id: 'comment_1' });
});

describe('CommentForm', () => {
  it('rejects empty input and shows an error', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }));
    });
    expect(mockAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Comment is required.');
  });

  it('rejects whitespace-only input', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: '   ' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }));
    });
    expect(mockAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Comment is required.');
  });

  it('clears the input on success', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Great event!' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }));
    });
    expect(mockAdd).toHaveBeenCalledWith('evt_1', 'Great event!');
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the action error when addComment returns {ok:false}', async () => {
    mockAdd.mockResolvedValue({ ok: false, error: 'This event has ended.' });
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Great event!' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This event has ended.');
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Great event!');
  });

  it('shows the generic error when addComment throws', async () => {
    mockAdd.mockRejectedValue(new Error('boom'));
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Great event!' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Please retry.',
    );
  });

  it('disables submit while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockAdd.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderForm();
    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Great event!' },
    });
    const submitBtn = screen.getByRole('button', { name: 'Post comment' });
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText('Posting…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(submitBtn).not.toBeDisabled();
  });

  it('enforces max length via the textarea maxLength attribute', () => {
    renderForm();
    expect(screen.getByLabelText('Add a comment')).toHaveAttribute(
      'maxLength',
      '1000',
    );
  });
});
