import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { Capability, CapabilityService } from '../../../shared/services/capability.service';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { CapabilitiesComponent } from './capabilities.component';

describe('CapabilitiesComponent', () => {
  let service: jasmine.SpyObj<CapabilityService>;
  let fixture: ComponentFixture<CapabilitiesComponent>;

  const icu: Capability = { id: 'c1-0000-0000', name: 'Intensive Care', level: 1, skill_group: null };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CapabilityService, useValue: service },
        { provide: ConfirmDialogService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    fixture = TestBed.createComponent(CapabilitiesComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    spyOn(console, 'error'); // the page logs each failure for developers
    service = jasmine.createSpyObj('CapabilityService', ['getCapabilities', 'deleteCapability', 'downloadTemplate', 'importFromFile', 'previewImport']);
  });

  it('shows a load error, not "No capabilities found", when the list fails', () => {
    service.getCapabilities.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    create();
    expect(query('[data-testid="load-error"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No capabilities found');
  });

  it('shows "No capabilities found" for a list that loaded empty', () => {
    service.getCapabilities.and.returnValue(of([]));
    create();
    expect(query('[data-testid="load-error"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No capabilities found');
  });

  it('reports a failed template download', () => {
    service.getCapabilities.and.returnValue(of([icu]));
    service.downloadTemplate.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    create();
    fixture.componentInstance.downloadTemplate();
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('could not be reached');
  });

  it("keeps the capability and shows the server's reason when a delete is refused", async () => {
    service.getCapabilities.and.returnValue(of([icu]));
    service.deleteCapability.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Capability is required by Emergency Room' } })),
    );
    create();
    await fixture.componentInstance.deleteCapability(icu);
    fixture.detectChanges();
    expect(query('[data-testid="error-notice"]')?.textContent).toContain('Capability is required by Emergency Room');
    expect(fixture.nativeElement.textContent).toContain('Intensive Care');
  });

  it('opens the import dialog for a chosen file and imports with the mapping that was confirmed', () => {
    service.getCapabilities.and.returnValue(of([]));
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
