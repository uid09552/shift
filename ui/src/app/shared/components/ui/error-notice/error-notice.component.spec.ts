import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ErrorNoticeComponent } from './error-notice.component';

describe('ErrorNoticeComponent', () => {
  let fixture: ComponentFixture<ErrorNoticeComponent>;

  function create(message: string | null) {
    fixture = TestBed.createComponent(ErrorNoticeComponent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
  }

  it('renders nothing and takes no space without a message', () => {
    create(null);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.classList).toContain('hidden');
  });

  it('shows the message as an alert', () => {
    create('Month 2026-10 is locked');
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Month 2026-10 is locked');
    expect(fixture.nativeElement.classList).not.toContain('hidden');
  });

  it('asks to be dismissed once per click on close', () => {
    create('Nope');
    let dismissed = 0;
    fixture.componentInstance.dismiss.subscribe(() => dismissed++);
    fixture.nativeElement.querySelector('button').click();
    expect(dismissed).toBe(1);
  });
});
