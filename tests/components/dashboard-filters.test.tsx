import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DashboardFilters } from '@/components/DashboardFilters';
import type { DashboardParams } from '@/lib/discovery';

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/my-events',
  useSearchParams: () => new URLSearchParams(),
}));

const baseParams: DashboardParams = {
  view: 'upcoming',
  q: '',
  sort: 'date',
};

const viewCounts = { upcoming: 0, past: 0, all: 0 };

function renderFilters(params: DashboardParams = baseParams) {
  return render(<DashboardFilters params={params} viewCounts={viewCounts} />);
}

beforeEach(() => {
  mockPush.mockClear();
});

describe('DashboardFilters', () => {
  it('navigates to dashboardHref when a view tab is clicked', () => {
    renderFilters({ ...baseParams, view: 'past' });
    fireEvent.click(screen.getByRole('button', { name: /^Past\d*$/ }));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=past'));
  });

  it('navigates when the Sort select changes', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'newest' },
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sort=newest'));
  });

  it('debounces search before navigating', async () => {
    vi.useFakeTimers();
    renderFilters();
    fireEvent.input(screen.getByLabelText('Search your events'), {
      target: { value: 'jazz' },
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('q=jazz'));
    vi.useRealTimers();
  });

  it('renders an active search chip and removes it on click', () => {
    renderFilters({ ...baseParams, q: 'jazz' });
    expect(screen.getByText(/“jazz”/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove search:/ }));
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('q='));
  });
});
