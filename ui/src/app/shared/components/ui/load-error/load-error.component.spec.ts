import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoadErrorComponent } from './load-error.component';

describe('LoadErrorComponent', () => {
  let fixture: ComponentFixture<LoadErrorComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(LoadErrorComponent);
    fixture.componentRef.setInput('message', 'The shifts could not be loaded.');
    fixture.detectChanges();
  });

  it('says what could not be loaded, as an alert', () => {
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('The shifts could not be loaded.');
  });

  it('asks for a retry once per click', () => {
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);
    fixture.nativeElement.querySelector('[data-testid="load-error-retry"] button').click();
    expect(retries).toBe(1);
  });
});
