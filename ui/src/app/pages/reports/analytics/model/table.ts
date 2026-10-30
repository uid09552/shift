import { CsvValue, toCsv } from './csv';

export interface TableColumn<T> {
  key: string;
  /** Translation key of the header. */
  label: string;
  value: (row: T) => string | number | null;
  numeric?: boolean;
  /** Part of the text search; on by default for text columns. */
  searchable?: boolean;
  /** Makes the cell a link into the app, e.g. the Audit log filtered to this row. */
  link?: (row: T) => { path: string; params: Record<string, string> } | null;
}

export interface TableSort {
  key: string;
  direction: 'asc' | 'desc';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The rows the table shows: searched (any searchable column contains the text, ignoring case) and sorted. */
export function tableRows<T>(rows: readonly T[], columns: readonly TableColumn<T>[], search: string, sort: TableSort | null): T[] {
  const needle = search.trim().toLocaleLowerCase();
  const searched = needle
    ? rows.filter((row) =>
        columns.some((c) => {
          if (c.searchable === false || (c.numeric && c.searchable !== true)) return false;
          const v = c.value(row);
          return v !== null && String(v).toLocaleLowerCase().includes(needle);
        }),
      )
    : [...rows];
  const column = sort && columns.find((c) => c.key === sort.key);
  if (column) {
    const sign = sort!.direction === 'asc' ? 1 : -1;
    searched.sort((a, b) => {
      const [x, y] = [column.value(a), column.value(b)];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empty cells last
      if (typeof x === 'number' && typeof y === 'number') return sign * (x - y);
      return sign * collator.compare(String(x), String(y));
    });
  }
  return searched;
}

/** The shown rows as CSV, with the shown columns under their translated headers. */
export function tableCsv<T>(rows: readonly T[], columns: readonly TableColumn<T>[], header: (label: string) => string): string {
  return toCsv(
    columns.map((c) => header(c.label)),
    rows.map((row) => columns.map((c) => c.value(row) as CsvValue)),
  );
}
