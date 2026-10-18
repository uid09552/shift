import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { CapabilityService } from '../../../shared/services/capability.service';
import { TranslationService as TranslationServiceToken } from '../../../shared/i18n/translation.service';
import { CapabilityFormComponent } from './capability-form.component';

describe('CapabilityFormComponent', () => {
  let service: jasmine.SpyObj<CapabilityService>;
  let router: jasmine.SpyObj<Router>;

  function create(id: string | null): CapabilityFormComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: CapabilityService, useValue: service },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } } },
      ],
    });
    const component = TestBed.runInInjectionContext(
      () => new CapabilityFormComponent(
        TestBed.inject(ActivatedRoute),
        TestBed.inject(Router),
        TestBed.inject(CapabilityService),
        TestBed.inject(TranslationServiceToken),
      ),
    );
    component.ngOnInit();
    return component;
  }

  beforeEach(() => {
    service = jasmine.createSpyObj('CapabilityService', ['getCapabilityById', 'createCapability', 'updateCapability']);
    router = jasmine.createSpyObj('Router', ['navigate']);
  });

  it('shows "not found" for an id that does not exist', () => {
    service.getCapabilityById.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const form = create('missing');
    expect(form.notFound).toBeTrue();
    expect(form.isDirty()).toBeFalse();
  });

  it('is dirty only once a value differs from what was loaded', () => {
    service.getCapabilityById.and.returnValue(of({ id: 'c1', name: 'ICU', level: 2, skill_group: null }));
    const form = create('c1');
    expect(form.isDirty()).toBeFalse();
    form.form.name = 'ICU nights';
    expect(form.isDirty()).toBeTrue();
  });

  it('returns to the list with the saved name after a save', () => {
    service.createCapability.and.returnValue(of({ id: 'c2', name: 'ER', level: 1, skill_group: null }));
    const form = create(null);
    form.form.name = ' ER ';
    form.save();
    expect(service.createCapability).toHaveBeenCalledWith({ name: 'ER', level: 1, skill_group: null });
    expect(router.navigate).toHaveBeenCalledWith(['/capabilities'], { state: { saved: 'ER' } });
    expect(form.isDirty()).toBeFalse();
  });

  it('keeps the form and its input when the backend refuses', () => {
    service.createCapability.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Duplicate' } })),
    );
    const form = create(null);
    form.form.name = 'ER';
    form.save();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(form.error).toContain('Duplicate');
    expect(form.form.name).toBe('ER');
  });
});
