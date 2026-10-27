import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RosterCheckInButton } from '@/app/events/[id]/RosterCheckInButton';

const { mockCheckInAttendee, mockUndoCheckIn } = vi.hoisted(() => ({
  mockCheckInAttendee: vi.fn(),
  mockUndoCheckIn: vi.fn(),
}));
vi.mock('@/app/events/actions', () => ({
  checkInAttendee: mockCheckInAttendee,
  undoCheckIn: mockUndoCheckIn,
}));

const mockCheckIn = vi.mocked(mockCheckInAttendee);
const mockUndo = vi.mocked(mockUndoCheckIn);

function renderButton({
  initialCheckedIn = false,
}: { initialCheckedIn?: boolean } = {}) {
  return render(
    <RosterCheckInButton
      eventId="evt_1"
      attendeeUserId="user_1"
      initialCheckedIn={initialCheckedIn}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIn.mockResolvedValue({ ok: true, checkedInAt: new Date().toISOString() });
  mockUndo.mockResolvedValue({ ok: true, checkedInAt: null });
});

describe('RosterCheckInButton', () => {
  it('renders unchecked state by default', () => {
    renderButton();
    expect(screen.getByLabelText('Check in attendee')).toBeInTheDocument();
    expect(screen.getByText('Check in')).toBeInTheDocument();
    expect(screen.queryByText('Checked in')).not.toBeInTheDocument();
  });

  it('renders checked state when initialCheckedIn is true', () => {
    renderButton({ initialCheckedIn: true });
    expect(screen.getByLabelText('Undo check-in')).toBeInTheDocument();
    expect(screen.getByText('Checked in')).toBeInTheDocument();
  });

  it('calls checkInAttendee and updates optimistically when checked', async () => {
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Check in attendee'));
    });
    expect(mockCheckIn).toHaveBeenCalledWith('evt_1', 'user_1');
    expect(screen.getByText('Checked in')).toBeInTheDocument();
  });

  it('reverts and shows alert when check-in returns {ok:false}', async () => {
    mockCheckIn.mockResolvedValue({ ok: false, error: 'Already checked in.' });
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Check in attendee'));
    });
    expect(screen.getByText('Check in')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Already checked in.');
  });

  it('reverts and shows alert when check-in throws', async () => {
    mockCheckIn.mockRejectedValue(new Error('boom'));
    renderButton();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Check in attendee'));
    });
    expect(screen.getByText('Check in')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check-in failed. Please retry.',
    );
  });

  it('disables the control and shows Saving while pending', async () => {
    let resolve!: (value: unknown) => void;
    mockCheckIn.mockImplementation(
      () => new Promise((res) => (resolve = res)),
    );
    renderButton();
    const checkbox = screen.getByLabelText('Check in attendee');
    fireEvent.click(checkbox);
    expect(checkbox).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => {
      resolve!(undefined);
    });
    expect(checkbox).not.toBeDisabled();
  });

  it('calls undoCheckIn when unchecking a checked-in attendee', async () => {
    renderButton({ initialCheckedIn: true });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Undo check-in'));
    });
    expect(mockUndo).toHaveBeenCalledWith('evt_1', 'user_1');
  });
});
