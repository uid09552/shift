import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { CommandPaletteComponent } from './command-palette.component';
import { CommandPaletteService } from './command-palette.service';

describe('CommandPaletteComponent', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let http: HttpTestingController;
  let navigate: jasmine.Spy;

  const query = (sel: string): HTMLElement | null => document.querySelector(sel);
  const input = () => query('[data-testid="command-palette-input"]') as HTMLInputElement;
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(CommandPaletteComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  function answer(roles: string[]) {
    http.match((r) => r.url.endsWith('/self')).forEach((r) => r.flush({ roles }));
    http.match((r) => r.url.endsWith('/employees')).forEach((r) => r.flush({ data: [{ id: 'e1', name: 'Anna Berg', email: 'a@x', capabilities: [] }], total: 1 }));
    http.match((r) => r.url.endsWith('/workstations')).forEach((r) => r.flush([{ id: 'w1', name: 'ICU' }]));
    http.match((r) => r.url.endsWith('/shifts')).forEach((r) => r.flush([]));
    http.match((r) => r.url.endsWith('/capabilities')).forEach((r) => r.flush([]));
    fixture.detectChanges();
  }

  it('opens with Ctrl+K from anywhere and closes with Escape, giving focus back', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(query('[data-testid="command-palette"]')).not.toBeNull();
    expect(document.activeElement).toBe(input());
    answer(['shift-viewer']);

    key('Escape');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    expect(query('[data-testid="command-palette"]')).toBeNull();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('moves with the arrow keys and opens the chosen entry with Enter', async () => {
    TestBed.inject(CommandPaletteService).open();
    fixture.detectChanges();
    answer(['shift-planner']);
    type('anna');
    const options = () => Array.from(document.querySelectorAll('[role="option"]'));
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    key('ArrowDown');
    fixture.detectChanges();
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    fixture.detectChanges();
    key('Enter');
    expect(navigate).toHaveBeenCalledWith(['/employee-calendar'], { queryParams: { employeeId: 'e1' } });
    expect(TestBed.inject(CommandPaletteService).isOpen).toBeFalse();
  });

  it('jumps to a typed date on the Schedule page', () => {
    TestBed.inject(CommandPaletteService).open();
    fixture.detectChanges();
    answer(['shift-viewer']);
    type('2026-12-24');
    expect(document.querySelector('[role="option"]')!.textContent).toContain('2026');
    key('Enter');
    expect(navigate).toHaveBeenCalledWith(['/kalender'], { queryParams: { date: '2026-12-24' } });
  });

  it('keeps Tab inside the dialog', () => {
    TestBed.inject(CommandPaletteService).open();
    fixture.detectChanges();
    answer(['shift-viewer']);
    input().focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(input());
  });
});
