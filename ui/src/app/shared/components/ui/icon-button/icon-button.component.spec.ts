import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconButtonComponent } from './icon-button.component';

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<IconButtonComponent>;
  let button: HTMLButtonElement;

  function create(inputs: Partial<Pick<IconButtonComponent, 'icon' | 'label' | 'tone' | 'disabled'>> = {}) {
    fixture = TestBed.createComponent(IconButtonComponent);
    fixture.componentRef.setInput('icon', inputs.icon ?? 'edit');
    fixture.componentRef.setInput('label', inputs.label ?? 'Bearbeiten');
    if (inputs.tone) fixture.componentRef.setInput('tone', inputs.tone);
    if (inputs.disabled !== undefined) fixture.componentRef.setInput('disabled', inputs.disabled);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button');
  }

  it('names the action for screen readers and as a tooltip', () => {
    create({ label: 'Löschen', icon: 'delete' });
    expect(button.getAttribute('aria-label')).toBe('Löschen');
    expect(button.title).toBe('Löschen');
    expect(button.textContent?.trim()).toBe('');
  });

  it('draws the requested icon', () => {
    create({ icon: 'remove-user' });
    expect(button.querySelector('svg circle')).not.toBeNull();
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('emits once per click', () => {
    create();
    const clicks: Event[] = [];
    fixture.componentInstance.btnClick.subscribe(e => clicks.push(e));
    button.click();
    expect(clicks.length).toBe(1);
  });

  it('emits nothing while disabled', () => {
    create({ disabled: true });
    const clicks: Event[] = [];
    fixture.componentInstance.btnClick.subscribe(e => clicks.push(e));
    button.click();
    fixture.componentInstance.onClick(new Event('click'));
    expect(button.disabled).toBeTrue();
    expect(clicks.length).toBe(0);
  });

  it('turns red only on hover for a danger action', () => {
    create({ tone: 'danger', icon: 'delete' });
    expect(button.className).toContain('hover:text-error-600');
    expect(button.className).not.toMatch(/(^|\s)bg-error-/);
  });
});
