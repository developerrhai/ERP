// Prototype .v8-pager pagination (Showing a–b of n, Prev, page numbers, Next) shared by the
// server-paginated tables so they page the same way.

export function pageWindow(page: number, pages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const out: number[] = [];
  for (let p = start; p <= Math.min(pages, start + 4); p += 1) out.push(p);
  return out;
}

interface PagerProps {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
}

export function Pager({ page, size, total, onPage }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <nav className="v8-pager" aria-label="Pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="pages">
        <button
          type="button"
          className="v8-page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        {pageWindow(page, pages).map((p) => (
          <button
            type="button"
            key={p}
            className={p === page ? 'v8-page active' : 'v8-page'}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="v8-page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
