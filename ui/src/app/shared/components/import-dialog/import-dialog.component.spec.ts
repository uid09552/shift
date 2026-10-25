import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';

import { ImportDialogComponent } from './import-dialog.component';
import { ImportConfirmation, ImportPreview } from './import.models';

describe('ImportDialogComponent', () => {
  let fixture: ComponentFixture<ImportDialogComponent>;
  let preview: jasmine.Spy<(file: File, sheet?: string) => Observable<ImportPreview>>;
  const file = new File(['x'], 'staff.xlsx');

  const detected = (over: Partial<ImportPreview> = {}): ImportPreview => ({
    sheets: ['Staff'],
    sheet: 'Staff',
    header_row: 3,
    row_count: 2,
    fields: [
      { key: 'name', required: true },
      { key: 'email', required: true },
      { key: 'weekly_working_hours', required: false },
    ],
    columns: [
      { index: 0, header: 'E-Mail', field: 'email', samples: ['anna@clinic.test'] },
      { index: 1, header: 'Mitarbeiter', field: 'name', samples: ['Anna Berg', 'Ben Kraft'] },
      { index: 2, header: 'Notiz', field: null, samples: [] },
    ],
    missing_required: [],
    ambiguous: [],
    ...over,
  });

  const el = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);
  const confirmButton = () => el('[data-testid="import-confirm"] button') as HTMLButtonElement;

  async function open(data: ImportPreview = detected()) {
    preview = jasmine.createSpy('preview').and.returnValue(of(data));
    fixture = TestBed.createComponent(ImportDialogComponent);
    fixture.componentRef.setInput('preview', preview);
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** What the user does: pick a field in a column's selector. */
  async function choose(column: number, field: string) {
    const select = el(`[data-testid="import-field-${column}"]`) as HTMLSelectElement;
    select.value = field;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const chosen = (column: number) => (el(`[data-testid="import-field-${column}"]`) as HTMLSelectElement).value;

  beforeEach(() => spyOn(console, 'error')); // a failed preview is logged for developers

  it('shows nothing without a file', () => {
    fixture = TestBed.createComponent(ImportDialogComponent);
    fixture.componentRef.setInput('preview', () => of(detected()));
    fixture.detectChanges();
    expect(el('[data-testid="import-dialog"]')).toBeNull();
  });

  it('lists every column with the field the server detected and lets the import go ahead', async () => {
    await open();
    expect(preview).toHaveBeenCalledOnceWith(file, undefined);
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="import-column-"]').length).toBe(3);
    expect([chosen(0), chosen(1), chosen(2)]).toEqual(['email', 'name', '']);
    expect(el('[data-testid="import-column-1"]')?.textContent).toContain('Anna Berg · Ben Kraft');
    expect(el('[data-testid="import-summary"]')?.textContent).toContain('row 3');
    expect(el('[data-testid="import-missing"]')).toBeNull();
    expect(confirmButton().disabled).toBeFalse();
  });

  it('names what is still missing and will not import until it is assigned', async () => {
    await open(detected({ columns: [
      { index: 0, header: 'Station', field: null, samples: ['Anna Berg'] },
      { index: 1, header: 'Kontakt', field: 'email', samples: ['anna@clinic.test'] },
    ] }));
    expect(el('[data-testid="import-missing"]')?.textContent).toContain('Name');
    expect(confirmButton().disabled).toBeTrue();

    await choose(0, 'name');
    expect(el('[data-testid="import-missing"]')).toBeNull();
    expect(confirmButton().disabled).toBeFalse();
  });

  it('takes a field away from the column that had it when another column is given it', async () => {
    await open();
    await choose(2, 'name');
    expect([chosen(1), chosen(2)]).toEqual(['', 'name']);
    expect(el('[data-testid="import-missing"]')).toBeNull(); // name has a column, just a different one

    await choose(2, '');
    expect(el('[data-testid="import-missing"]')?.textContent).toContain('Name');
  });

  it('hands over the file and exactly what was assigned', async () => {
    await open();
    await choose(2, 'weekly_working_hours');
    let confirmation: ImportConfirmation | undefined;
    fixture.componentInstance.confirmed.subscribe((c) => (confirmation = c));

    confirmButton().click();
    expect(confirmation?.file).toBe(file);
    expect(confirmation?.mapping).toEqual({
      sheet: 'Staff',
      header_row: 3,
      columns: { email: 0, name: 1, weekly_working_hours: 2 },
    });
  });

  it('reads another sheet when one is chosen, starting again from what is detected there', async () => {
    await open(detected({ sheets: ['Cover', 'Staff'] }));
    preview.and.returnValue(of(detected({ sheets: ['Cover', 'Staff'], sheet: 'Cover', columns: [
      { index: 0, header: 'Titel', field: null, samples: ['Q4'] },
    ] })));

    const select = el('[data-testid="import-sheet"]') as HTMLSelectElement;
    select.value = 'Cover';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(preview).toHaveBeenCalledWith(file, 'Cover');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="import-column-"]').length).toBe(1);
    expect(confirmButton().disabled).toBeTrue();
  });

  it('shows no sheet selector for a workbook with one sheet', async () => {
    await open();
    expect(el('[data-testid="import-sheet"]')).toBeNull();
  });

  it("says why when the file cannot be read, and offers nothing to import", async () => {
    preview = jasmine.createSpy('preview').and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Could not read the uploaded file as a spreadsheet' } })),
    );
    fixture = TestBed.createComponent(ImportDialogComponent);
    fixture.componentRef.setInput('preview', preview);
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el('[data-testid="import-error"]')?.textContent).toContain('Could not read the uploaded file as a spreadsheet');
    expect(confirmButton()).toBeNull();
  });

  it('asks to be closed from the cancel button, importing nothing', async () => {
    await open();
    let cancelled = 0;
    let confirmed = 0;
    fixture.componentInstance.cancel.subscribe(() => cancelled++);
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);
    const cancel = [...fixture.nativeElement.querySelectorAll('button')].find((b) => /cancel/i.test((b as HTMLElement).textContent ?? ''));
    (cancel as HTMLButtonElement).click();
    expect([cancelled, confirmed]).toEqual([1, 0]);
  });

  it('names columns the way a spreadsheet does', async () => {
    await open();
    const letters = [0, 1, 25, 26, 27, 701, 702].map((i) => fixture.componentInstance.letter(i));
    expect(letters).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
