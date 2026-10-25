import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable } from 'rxjs';

import { ImportColumnMapping, ImportPreview } from '../components/import-dialog/import.models';
import { CapabilityService } from './capability.service';
import { EmployeeService } from './employee.service';
import { ShiftService } from './shift.service';
import { WorkstationService } from './workstation.service';

/** The four importing services send the same multipart parts to their own URLs. */
describe('import through the services', () => {
  let http: HttpTestingController;
  const file = new File(['x'], 'staff.xlsx');
  const mapping: ImportColumnMapping = { sheet: 'Staff', header_row: 3, columns: { name: 1, email: 0 } };

  interface Importing {
    previewImport(file: File, sheet?: string): Observable<ImportPreview>;
    importFromFile(file: File, mapping?: ImportColumnMapping): Observable<unknown>;
  }
  const cases: [string, () => Importing, string][] = [
    ['shifts', () => TestBed.inject(ShiftService), '/api/v1/shifts/import'],
    ['capabilities', () => TestBed.inject(CapabilityService), '/api/v1/capabilities/import'],
    ['workstations', () => TestBed.inject(WorkstationService), '/api/v1/workstations/import'],
    ['employees', () => TestBed.inject(EmployeeService), '/api/v1/employees/import'],
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  for (const [name, service, url] of cases) {
    it(`${name}: a preview posts the file, and the sheet only when one is chosen`, () => {
      service().previewImport(file).subscribe();
      const first = http.expectOne(`${url}/preview`);
      expect(first.request.method).toBe('POST');
      expect((first.request.body as FormData).get('file')).toBe(file);
      expect((first.request.body as FormData).has('sheet')).toBeFalse();

      service().previewImport(file, 'Mitarbeiter').subscribe();
      const second = http.expectOne(`${url}/preview`);
      expect((second.request.body as FormData).get('sheet')).toBe('Mitarbeiter');
    });

    it(`${name}: an import sends the user's mapping as JSON, and none when there is none`, () => {
      service().importFromFile(file, mapping).subscribe();
      const mapped = http.expectOne(url);
      const form = mapped.request.body as FormData;
      expect(form.get('file')).toBe(file);
      expect(JSON.parse(form.get('mapping') as string)).toEqual(mapping);

      service().importFromFile(file).subscribe();
      const plain = http.expectOne(url);
      expect((plain.request.body as FormData).has('mapping')).toBeFalse();
    });
  }
});
