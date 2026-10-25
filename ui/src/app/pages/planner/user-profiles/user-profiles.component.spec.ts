import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { EmployeeProfile, EmployeeService, PaginatedEmployeeResponse } from '../../../shared/services/employee.service';
import { PlannerSettingsService } from '../../../shared/services/planner-settings.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { UserProfilesComponent } from './user-profiles.component';

describe('UserProfilesComponent', () => {
  let service: jasmine.SpyObj<EmployeeService>;
  let fixture: ComponentFixture<UserProfilesComponent>;

  const anna: EmployeeProfile = {
    id: 'e1', name: 'Anna Berg', email: 'anna@clinic.test', weekly_working_hours: null,
    effective_weekly_working_hours: 40, shifts: [], capabilities: [],
  };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EmployeeService, useValue: service },
        { provide: PlannerSettingsService, useValue: { getPlannerSettings: () => of({ default_weekly_working_hours: 40 }) } },
        { provide: ConfirmDialogService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    fixture = TestBed.createComponent(UserProfilesComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    service = jasmine.createSpyObj('EmployeeService', ['getEmployeeProfiles', 'deleteEmployee', 'downloadTemplate', 'importFromFile', 'previewImport']);
  });

  it('shows a load error and no pagination, not an empty staff list, when loading fails', () => {
    service.getEmployeeProfiles.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    create();
    expect(query('[data-testid="load-error"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Showing');
  });

  it("keeps the employee and shows the server's reason when a delete is refused", async () => {
    service.getEmployeeProfiles.and.returnValue(of({
      data: [{ id: anna.id, name: anna.name, email: anna.email, weekly_working_hours: null, effective_weekly_working_hours: 40, available_shifts: [], capabilities: [] }],
      total: 1,
    } as unknown as PaginatedEmployeeResponse));
    service.deleteEmployee.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Anna Berg has confirmed shifts in a locked month' } })),
    );
    create();
    await fixture.componentInstance.deleteEmployee(anna);
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('confirmed shifts in a locked month');
    expect(fixture.nativeElement.textContent).toContain('Anna Berg');
  });

  it('opens the import dialog for a chosen file and imports with the mapping that was confirmed', () => {
    service.getEmployeeProfiles.and.returnValue(of({ data: [], total: 0 } as unknown as PaginatedEmployeeResponse));
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
