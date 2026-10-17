import Link from 'next/link';
import { eventListHref, type EventListParams } from '@/lib/discovery';

type Props = {
  params: EventListParams;
  page: number;
  pageCount: number;
};

type WindowItem = number | 'gap';

/** First/last plus a window around the current page, with ellipses between. */
function pageWindow(page: number, pageCount: number): WindowItem[] {
  const numbers = new Set<number>([
    1,
    pageCount,
    page - 2,
    page - 1,
    page,
    page + 1,
    page + 2,
  ]);
  const sorted = [...numbers]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b);

  const result: WindowItem[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous !== 0 && n - previous > 1) result.push('gap');
    result.push(n);
    previous = n;
  }
  return result;
}

const ITEM_CLASS =
  'inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md border px-2 text-sm';

export function Pagination({ params, page, pageCount }: Props) {
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
          href={eventListHref(params, { page: page - 1 })}
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

      {pageWindow(page, pageCount).map((item, index) =>
        item === 'gap' ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-1 text-muted"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className={`${ITEM_CLASS} border-primary bg-primary font-medium text-white`}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={eventListHref(params, { page: item })}
            aria-label={`Page ${item}`}
            className={`${ITEM_CLASS} border-border text-foreground hover:border-primary hover:text-primary`}
          >
            {item}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link
          href={eventListHref(params, { page: page + 1 })}
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
