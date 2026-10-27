import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageNav } from '@/components/PageNav';

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

describe('PageNav', () => {
  it('renders nothing when there is only one page', () => {
    render(<PageNav page={1} pageCount={1} hrefForPage={(p) => `/x?page=${p}`} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders Previous/Next hrefs via hrefForPage', () => {
    render(
      <PageNav
        page={2}
        pageCount={5}
        hrefForPage={(p) => `/x?page=${p}`}
      />,
    );
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/x?page=1',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/x?page=3',
    );
  });

  it('disables Previous on the first page and Next on the last page', () => {
    render(
      <PageNav page={1} pageCount={3} hrefForPage={(p) => `/x?page=${p}`} />,
    );
    const prev = screen.getAllByText('Previous')[0];
    expect(prev).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders Page N of M', () => {
    render(
      <PageNav page={2} pageCount={5} hrefForPage={(p) => `/x?page=${p}`} />,
    );
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });
});
