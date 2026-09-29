"use client";
// Owner task: EB-97 Shared data components — sortable, filterable table. Keyboard: sort buttons in headers,
// links in cells. Narrow screens scroll the table inside its frame (never the page).
import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number;
  /** Text searched by the filter box. */
  text?: (row: T) => string;
  numeric?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  searchPlaceholder,
  initialSort,
  empty = "Nothing to show.",
  toolbar,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  searchPlaceholder?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  empty?: ReactNode;
  toolbar?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) => columns.some((c) => (c.text?.(r) ?? "").toLowerCase().includes(needle)))
      : rows.slice();
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sort) {
      const f = col.sort;
      out = out.sort((a, b) => {
        const x = f(a);
        const y = f(b);
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort!.dir === "asc" ? r : -r;
      });
    }
    return out;
  }, [rows, columns, q, sort]);

  const searchable = columns.some((c) => c.text);

  return (
    <div>
      {searchable || toolbar ? (
        <div className="table-tools">
          {searchable ? (
            <input
              type="search"
              className="input input-search"
              placeholder={searchPlaceholder ?? "Filter…"}
              aria-label={`Filter ${caption}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
          {toolbar}
          {q ? (
            <span className="muted" role="status" style={{ fontSize: "var(--fs-xs)" }}>
              {view.length} of {rows.length}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined;
                return (
                  <th key={c.key} scope="col" className={c.numeric ? "num" : undefined} aria-sort={ariaSort}>
                    {c.sort ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() =>
                          setSort(active && sort!.dir === "asc" ? { key: c.key, dir: "desc" } : { key: c.key, dir: "asc" })
                        }
                      >
                        {c.header}
                        <span className="sort-ind" aria-hidden="true">
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.length ? (
              view.map((r) => (
                <tr key={rowKey(r)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  {q ? `No rows match “${q}”.` : empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
