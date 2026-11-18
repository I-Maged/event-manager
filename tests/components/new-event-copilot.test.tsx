import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import NewEventPage from '@/app/events/new/page';

const { mockDraft, mockCreate } = vi.hoisted(() => ({
  mockDraft: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@/app/events/new/actions', () => ({
  createEvent: mockCreate,
  draftEventDescription: mockDraft,
}));

describe('NewEventPage copilot', () => {
  beforeEach(() => {
    mockDraft.mockReset();
    mockCreate.mockReset();
  });

  it('shows error when draft fails', async () => {
    mockDraft.mockResolvedValue({ ok: false, error: 'boom' });
    render(<NewEventPage />);
    const title = screen.getByLabelText(/title/i) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'picnic' } });
    const btn = screen.getByRole('button', { name: /draft description/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });

  it('renders preview and applies all on success', async () => {
    mockDraft.mockResolvedValue({
      ok: true,
      suggestion: { title: 'Sunset Picnic', description: 'Join us.', category: 'COMMUNITY', capacity: 25 },
      auditId: 'audit_1',
    });
    render(<NewEventPage />);
    const title = screen.getByLabelText(/^title$/i) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'picnic' } });
    const btn = screen.getByRole('button', { name: /draft description/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(screen.getByText(/suggested/i)).toBeInTheDocument());
    const apply = screen.getByRole('button', { name: /apply all/i });
    await act(async () => { fireEvent.click(apply); });
    expect((screen.getByLabelText(/^title$/i) as HTMLInputElement).value).toBe('Sunset Picnic');
    expect((screen.getByLabelText(/description/i) as HTMLTextAreaElement).value).toBe('Join us.');
  });
});