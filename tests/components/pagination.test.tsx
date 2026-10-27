import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from '@/components/Pagination';
import type { EventListParams } from '@/lib/discovery';

vi.mock('next/link', () => {
  const Link = ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a data-testid="nav-link" href={href} {...props}>
      {children}
    </a>
  );
  return { default: Link };
});

const params: EventListParams = {
  q: '',
  category: null,
  when: 'any',
  sort: 'date',
  organizer: null,
  page: 1,
};

describe('Pagination', () => {
  it('renders nothing when there is only one page', () => {
    render(<Pagination params={params} page={1} pageCount={1} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders Previous/Next hrefs via eventListHref', () => {
    render(<Pagination params={params} page={2} pageCount={5} />);
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/events?page=3',
    );
  });

  it('renders the page window with the current page highlighted', () => {
    render(<Pagination params={params} page={3} pageCount={10} />);
    expect(screen.getByText('3')).toHaveAttribute('aria-current', 'page');
  });

  it('omits unavailable boundary pages', () => {
    render(<Pagination params={params} page={1} pageCount={2} />);
    const prev = screen.getByText('Previous');
    expect(prev).toHaveAttribute('aria-disabled', 'true');
  });
});
