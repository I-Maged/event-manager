import Link from 'next/link';

type Props = {
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
};

const ITEM_CLASS =
  'inline-flex min-h-[36px] items-center justify-center rounded-md border px-3 text-sm';

/**
 * Minimal Previous/Next navigator for lists that don't use `EventListParams`
 * (the shared `Pagination` component builds `/events` hrefs). Renders nothing
 * when there is only one page.
 */
export function PageNav({ page, pageCount, hrefForPage }: Props) {
  if (pageCount <= 1) return null;

  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {hasPrev ? (
        <Link
          href={hrefForPage(page - 1)}
          rel="prev"
          className={`${ITEM_CLASS} border-border text-foreground hover:border-primary hover:text-primary`}
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={`${ITEM_CLASS} cursor-not-allowed border-border text-muted opacity-50`}
        >
          Previous
        </span>
      )}

      <span className="text-sm text-muted">
        Page {page} of {pageCount}
      </span>

      {hasNext ? (
        <Link
          href={hrefForPage(page + 1)}
          rel="next"
          className={`${ITEM_CLASS} border-border text-foreground hover:border-primary hover:text-primary`}
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={`${ITEM_CLASS} cursor-not-allowed border-border text-muted opacity-50`}
        >
          Next
        </span>
      )}
    </nav>
  );
}
