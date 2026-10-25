import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { Shift, ShiftService } from '../../../shared/services/shift.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { ShiftsComponent } from './shifts.component';

describe('ShiftsComponent', () => {
  let service: jasmine.SpyObj<ShiftService>;
  let fixture: ComponentFixture<ShiftsComponent>;

  const early = { id: 's1', name: 'Early', short_name: 'E', color: '#3B82F6', weekday_times: [] } as unknown as Shift;
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ShiftService, useValue: service },
        { provide: ConfirmDialogService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    fixture = TestBed.createComponent(ShiftsComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    service = jasmine.createSpyObj('ShiftService', ['getShifts', 'deleteShift', 'downloadTemplate', 'importFromFile', 'previewImport']);
  });

  it('shows a load error with retry, not the empty state, when the list fails', () => {
    service.getShifts.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    create();
    expect(query('[data-testid="load-error"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No shifts');
  });

  it('loads again on retry and drops the error', () => {
    service.getShifts.and.returnValues(throwError(() => new HttpErrorResponse({ status: 500 })), of([early]));
    create();
    (query('[data-testid="load-error-retry"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="load-error"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Early');
  });

  it('shows the empty state only for a list that loaded empty', () => {
    service.getShifts.and.returnValue(of([]));
    create();
    expect(query('[data-testid="load-error"]')).toBeNull();
  });

  it("keeps the shift and shows the server's reason when a delete is refused", async () => {
    service.getShifts.and.returnValue(of([early]));
    service.deleteShift.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Shift is still used by 2 workstations' } })),
    );
    create();
    await fixture.componentInstance.deleteShift(early);
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('Shift is still used by 2 workstations');
    expect(fixture.nativeElement.textContent).toContain('Early');
    expect(service.getShifts).toHaveBeenCalledTimes(1);
  });

  it('opens the import dialog for a chosen file and imports with the mapping that was confirmed', () => {
    service.getShifts.and.returnValue(of([]));
    service.previewImport.and.returnValue(of({
      sheets: ['S'], sheet: 'S', header_row: 1, row_count: 1, missing_required: [], ambiguous: [],
      fields: [{ key: 'name', required: true }],
      columns: [{ index: 0, header: 'Name', field: 'name', samples: ['x'] }],
    }));
    service.importFromFile.and.returnValue(of({ created: 1, skipped: 0, errors: [] }));
    create();

    const file = new File(['x'], 'upload.xlsx');
    fixture.componentInstance.onImportFileSelected({ target: { files: [file], value: 'upload.xlsx' } } as unknown as Event);
    fixture.detectChanges();
    expect(query('[data-testid="import-dialog"]')).not.toBeNull();
    expect(service.previewImport).toHaveBeenCalledWith(file, undefined);
    expect(service.importFromFile).not.toHaveBeenCalled();

    (query('[data-testid="import-confirm"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.importFromFile).toHaveBeenCalledOnceWith(file, { sheet: 'S', header_row: 1, columns: { name: 0 } });
    expect(query('[data-testid="import-dialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Import finished: 1 created');
  });
});
