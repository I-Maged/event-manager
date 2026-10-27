import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { InviteLinkManager } from '@/app/events/[id]/InviteLinkManager';

const { mockCreateInviteLink, mockRegenerateInviteLink, mockRevokeInviteLink } =
  vi.hoisted(() => ({
    mockCreateInviteLink: vi.fn(),
    mockRegenerateInviteLink: vi.fn(),
    mockRevokeInviteLink: vi.fn(),
  }));
vi.mock('@/app/events/actions', () => ({
  createInviteLink: mockCreateInviteLink,
  regenerateInviteLink: mockRegenerateInviteLink,
  revokeInviteLink: mockRevokeInviteLink,
}));

const mockCreate = vi.mocked(mockCreateInviteLink);
const mockRegenerate = vi.mocked(mockRegenerateInviteLink);
const mockRevoke = vi.mocked(mockRevokeInviteLink);

function renderManager({ initialToken = null }: { initialToken?: string | null } = {}) {
  return render(<InviteLinkManager eventId="evt_1" initialToken={initialToken} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCreate.mockResolvedValue({ ok: true, token: 'tok_abc' });
  mockRegenerate.mockResolvedValue({ ok: true, token: 'tok_def' });
  mockRevoke.mockResolvedValue({ ok: true });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InviteLinkManager', () => {
  it('shows the create button when there is no token', () => {
    renderManager();
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeInTheDocument();
    expect(screen.queryByText(/tok_/)).not.toBeInTheDocument();
  });

  it('calls createInviteLink and shows the relative link after create', async () => {
    renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    });
    expect(mockCreate).toHaveBeenCalledWith('evt_1');
    expect(screen.getByLabelText('Invite link')).toHaveValue('/invite/tok_abc');
    expect(screen.getByText('Invite link ready.')).toBeInTheDocument();
  });

  it('builds an absolute URL and writes to the clipboard on copy', async () => {
    mockCreate.mockResolvedValue({ ok: true, token: 'tok_abc' });
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } } as never);
    renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/invite/tok_abc');
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('shows a manual-copy message when clipboard fails', async () => {
    mockCreate.mockResolvedValue({ ok: true, token: 'tok_abc' });
    const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
    vi.stubGlobal('navigator', { clipboard: { writeText } } as never);
    renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(screen.getByText('Copy failed — select the link manually.')).toBeInTheDocument();
  });

  it('asks for confirmation before regenerating', async () => {
    renderManager({ initialToken: 'tok_abc' });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate link' }));
    });
    expect(confirm).toHaveBeenCalledWith(
      'Generate a new link? The current link will stop working.',
    );
    expect(mockRegenerate).toHaveBeenCalledWith('evt_1');
    expect(screen.getByLabelText('Invite link')).toHaveValue('/invite/tok_def');
  });

  it('does not regenerate when the user declines confirmation', async () => {
    renderManager({ initialToken: 'tok_abc' });
    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate link' }));
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it('asks for confirmation before revoking', async () => {
    renderManager({ initialToken: 'tok_abc' });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    });
    expect(confirm).toHaveBeenCalledWith(
      'Revoke this invite link? Previously shared URLs will stop working.',
    );
    expect(mockRevoke).toHaveBeenCalledWith('evt_1');
    expect(screen.queryByLabelText('Invite link')).not.toBeInTheDocument();
    expect(screen.getByText('Invite link revoked.')).toBeInTheDocument();
  });

  it('shows an alert for action errors', async () => {
    mockCreate.mockResolvedValue({ ok: false, error: 'Only organizers can create links.' });
    renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Only organizers can create links.');
  });

  it('shows the generic message when the action throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    renderManager();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    });
    expect(screen.getByText('Something went wrong. Please retry.')).toBeInTheDocument();
  });

  it('disables all controls while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockCreate.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderManager();
    const createBtn = screen.getByRole('button', { name: 'Create invite link' });
    fireEvent.click(createBtn);
    expect(createBtn).toBeDisabled();
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(createBtn).not.toBeDisabled();
  });
});
