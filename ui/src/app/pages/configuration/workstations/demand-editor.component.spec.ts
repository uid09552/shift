import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DemandEditorComponent } from './demand-editor.component';

describe('DemandEditorComponent', () => {
  it('loads the curves, copies Monday and saves only the days with demand', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DemandEditorComponent);
    fixture.componentRef.setInput('workstationId', 'w1');
    fixture.detectChanges();
    const monday = Array(24).fill(0).map((_, h) => (h >= 7 && h < 19 ? 2 : 0));
    http.expectOne('/api/v1/workstations/w1/demand').flush({ workstation_id: 'w1', weekdays: [{ weekday: 0, hours: monday }] });
    fixture.detectChanges();
    const cell = fixture.nativeElement.querySelector('[data-testid="demand-0-8"]') as HTMLInputElement;
    expect(cell.getAttribute('aria-label')).toContain('08:00–09:00');

    const editor = fixture.componentInstance;
    editor.set(0, 8, '150');
    expect(editor.rows[0].hours[8]).toBe(99, 'bounded');
    editor.set(0, 8, '3');
    editor.copyMonday();
    expect(editor.rows[4].hours[8]).toBe(3);
    editor.rows[6].hours = Array(24).fill(0);
    editor.save();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/v1/workstations/w1/demand');
    expect(put.request.body.weekdays.map((d: { weekday: number }) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5]);
    put.flush({ workstation_id: 'w1', weekdays: put.request.body.weekdays });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Saved.');
  });
});
