import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { Workstation, WorkstationDetail, WorkstationService } from '../../../shared/services/workstation.service';
import { ShiftService } from '../../../shared/services/shift.service';
import { WorkstationUnavailabilityService } from '../../../shared/services/workstation-unavailability.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { WorkstationsComponent } from './workstations.component';

describe('WorkstationsComponent', () => {
  let workstations: jasmine.SpyObj<WorkstationService>;
  let fixture: ComponentFixture<WorkstationsComponent>;

  const er: Workstation = {
    id: 'w1', name: 'Emergency Room', available: true, active_shift_ids: [], priority: 'high', min_employees: 1, max_employees: 3,
  };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: WorkstationService, useValue: workstations },
        { provide: ShiftService, useValue: { getShifts: () => of([]) } },
        { provide: WorkstationUnavailabilityService, useValue: { getAllUnavailabilities: () => of([]) } },
        { provide: ConfirmDialogService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    fixture = TestBed.createComponent(WorkstationsComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    workstations = jasmine.createSpyObj('WorkstationService', [
      'getWorkstations', 'getWorkstationById', 'deleteWorkstation', 'enable', 'downloadTemplate', 'importFromFile', 'previewImport',
    ]);
    workstations.getWorkstationById.and.returnValue(of({ ...er, required_capabilities: [] } as unknown as WorkstationDetail));
  });

  it('shows a load error, not the empty state, when the list fails', () => {
    workstations.getWorkstations.and.returnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
    create();
    expect(query('[data-testid="load-error"]')).not.toBeNull();
  });

  it('says so when the required capabilities could not be loaded', () => {
    workstations.getWorkstations.and.returnValue(of([er]));
    workstations.getWorkstationById.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    create();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('required capabilities could not be loaded');
  });

  it("keeps the workstation and shows the server's reason when reactivating is refused", () => {
    workstations.getWorkstations.and.returnValue(of([{ ...er, available: false }]));
    workstations.enable.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Only planners may do that' } })));
    create();
    fixture.componentInstance.reactivate({ ...er, available: false });
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('Only planners may do that');
    expect(fixture.componentInstance.togglingId).toBeNull();
  });

  it('reports a refused delete and does not reload', async () => {
    workstations.getWorkstations.and.returnValue(of([er]));
    workstations.deleteWorkstation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    create();
    await fixture.componentInstance.deleteWorkstation(er);
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('could not be deleted');
    expect(workstations.getWorkstations).toHaveBeenCalledTimes(1);
  });

  it('opens the import dialog for a chosen file and imports with the mapping that was confirmed', () => {
    workstations.getWorkstations.and.returnValue(of([]));
    workstations.previewImport.and.returnValue(of({
      sheets: ['S'], sheet: 'S', header_row: 1, row_count: 1, missing_required: [], ambiguous: [],
      fields: [{ key: 'name', required: true }],
      columns: [{ index: 0, header: 'Name', field: 'name', samples: ['x'] }],
    }));
    workstations.importFromFile.and.returnValue(of({ created: 1, skipped: 0, errors: [] }));
    create();

    const file = new File(['x'], 'upload.xlsx');
    fixture.componentInstance.onImportFileSelected({ target: { files: [file], value: 'upload.xlsx' } } as unknown as Event);
    fixture.detectChanges();
    expect(query('[data-testid="import-dialog"]')).not.toBeNull();
    expect(workstations.previewImport).toHaveBeenCalledWith(file, undefined);
    expect(workstations.importFromFile).not.toHaveBeenCalled();

    (query('[data-testid="import-confirm"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(workstations.importFromFile).toHaveBeenCalledOnceWith(file, { sheet: 'S', header_row: 1, columns: { name: 0 } });
    expect(query('[data-testid="import-dialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Import finished: 1 created');
  });
});
