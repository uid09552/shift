import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';

import { DetailTableComponent, PAGE_SIZE } from './detail-table.component';
import { TableColumn } from './model/table';

interface Row {
  name: string;
  hours: number;
}

describe('DetailTableComponent', () => {
  let fixture: ComponentFixture<DetailTableComponent<Row>>;
  const columns: TableColumn<Row>[] = [
    { key: 'name', label: 'analytics.dim.employee', value: (r) => r.name },
    { key: 'hours', label: 'Hours', value: (r) => r.hours, numeric: true },
  ];

  function render(rows: Row[], search = ''): HTMLElement {
    fixture = TestBed.createComponent(DetailTableComponent<Row>);
    fixture.componentRef.setInput('columns', columns);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('search', search);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const rowCount = (el: HTMLElement) => el.querySelectorAll('[data-testid="analytics-table-row"]').length;

  it('shows only the rows matching the search', () => {
    const rows = [{ name: 'Anna', hours: 8 }, { name: 'Ben', hours: 6 }, { name: 'Hanna', hours: 4 }];
    expect(rowCount(render(rows))).toBe(3);
    expect(rowCount(render(rows, 'anna'))).toBe(2);
  });

  it('emits the typed search once the typing pauses', fakeAsync(() => {
    render([{ name: 'Anna', hours: 8 }]);
    const emitted: string[] = [];
    fixture.componentInstance.searchChange.subscribe((s) => emitted.push(s));
    fixture.componentInstance.typed('A');
    fixture.componentInstance.typed('An');
    tick(300);
    expect(emitted).toEqual(['An']);
  }));

  it('pages long tables and exports every shown row, not just the page', () => {
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ name: `P${i}`, hours: i }));
    const el = render(rows);
    expect(rowCount(el)).toBe(PAGE_SIZE);
    fixture.componentInstance.go(1);
    fixture.detectChanges();
    expect(rowCount(el)).toBe(5);

    const text = fixture.componentInstance.csvText();
    expect(text.trim().split('\r\n').length).toBe(PAGE_SIZE + 5 + 1);
  });
});
