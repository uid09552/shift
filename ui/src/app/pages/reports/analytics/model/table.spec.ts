import { TableColumn, tableCsv, tableRows } from './table';

interface Row {
  name: string;
  reason: string | null;
  hours: number;
}

const columns: TableColumn<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'reason', label: 'Reason', value: (r) => r.reason },
  { key: 'hours', label: 'Hours', value: (r) => r.hours, numeric: true },
];

const rows: Row[] = [
  { name: 'Ben', reason: 'Krankmeldung Anna', hours: 8 },
  { name: 'Anna', reason: null, hours: 12 },
  { name: 'Carla', reason: 'Tausch', hours: 10 },
];

describe('tableRows', () => {
  it('narrows to rows where any text column contains the search, ignoring case', () => {
    expect(tableRows(rows, columns, 'krank', null).map((r) => r.name)).toEqual(['Ben']);
    expect(tableRows(rows, columns, 'ANNA', null).map((r) => r.name)).toEqual(['Ben', 'Anna']);
  });

  it('does not search numeric columns', () => {
    expect(tableRows(rows, columns, '12', null)).toEqual([]);
  });

  it('sorts text and numbers in either direction, empty cells last', () => {
    expect(tableRows(rows, columns, '', { key: 'name', direction: 'asc' }).map((r) => r.name)).toEqual(['Anna', 'Ben', 'Carla']);
    expect(tableRows(rows, columns, '', { key: 'hours', direction: 'desc' }).map((r) => r.hours)).toEqual([12, 10, 8]);
    expect(tableRows(rows, columns, '', { key: 'reason', direction: 'asc' }).map((r) => r.name)).toEqual(['Ben', 'Carla', 'Anna']);
  });
});

describe('tableCsv', () => {
  it('exports exactly the shown rows under the shown columns', () => {
    const shown = tableRows(rows, columns, 'krank', null);
    const csv = tableCsv(shown, columns, (label) => `[${label}]`);
    expect(csv.slice(1)).toBe('[Name],[Reason],[Hours]\r\nBen,Krankmeldung Anna,8\r\n');
  });
});
