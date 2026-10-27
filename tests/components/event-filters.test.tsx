import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventFilters } from '@/components/EventFilters';
import { EVENT_CATEGORIES } from '@/lib/categories';
import type { EventCategory } from '@/generated/prisma';
import type { EventListParams } from '@/lib/discovery';

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/events',
  useSearchParams: () => new URLSearchParams(),
}));

const baseParams: EventListParams = {
  q: '',
  category: null,
  when: 'any',
  sort: 'date',
  organizer: null,
  page: 1,
};

const categoryCounts = Object.fromEntries(
  EVENT_CATEGORIES.map((category) => [category.value, 0]),
) as Record<EventCategory, number>;

function renderFilters(params: EventListParams = baseParams) {
  return render(
    <EventFilters
      params={params}
      categoryCounts={categoryCounts}
      organizerName={null}
    />,
  );
}

beforeEach(() => {
  mockPush.mockClear();
});

describe('EventFilters', () => {
  it('navigates to the expected href when a category chip is clicked', () => {
    renderFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Music\d*$/ }));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('category=MUSIC'));
  });

  it('toggles an active category off when clicked again', () => {
    renderFilters({ ...baseParams, category: 'MUSIC' });
    fireEvent.click(screen.getByRole('button', { name: /^Music\d*$/ }));
    expect(mockPush).toHaveBeenCalledWith('/events');
  });

  it('navigates when the When select changes', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: 'week' },
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('when=week'));
  });

  it('navigates when the Sort select changes', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'newest' },
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sort=newest'));
  });

  it('debounces search before navigating (fake timers)', async () => {
    vi.useFakeTimers();
    renderFilters();
    fireEvent.input(screen.getByLabelText('Search events'), {
      target: { value: 'jazz' },
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('q=jazz'));
    vi.useRealTimers();
  });

  it('resyncs the search input when the URL-provided query changes', () => {
    renderFilters({ ...baseParams, q: 'jazz' });
    expect(screen.getByLabelText('Search events')).toHaveValue('jazz');
  });

  it('renders active chips for q/category/when/sort/organizer', () => {
    renderFilters({
      ...baseParams,
      q: 'jazz',
      category: 'MUSIC',
      when: 'week',
      sort: 'newest',
      organizer: 'ada',
    });
    const musicBtn = screen.getByRole('button', { name: /^Music\d*$/ });
    expect(musicBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Remove filter: “jazz”/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove filter: Next 7 days/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove filter: Sort: Newest/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove filter: One organizer/ })).toBeInTheDocument();
  });

  it('navigates to the chip href when removing a chip', () => {
    renderFilters({ ...baseParams, q: 'jazz' });
    fireEvent.click(screen.getByRole('button', { name: /Remove filter:/ }));
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('q='));
  });

  it('resets to the default URL on Clear all', () => {
    renderFilters({ ...baseParams, q: 'jazz' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(mockPush).toHaveBeenCalledWith('/events');
  });

  it('sets aria-pressed on the active category', () => {
    renderFilters({ ...baseParams, category: 'MUSIC' });
    expect(screen.getByRole('button', { name: /^Music\d*$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
