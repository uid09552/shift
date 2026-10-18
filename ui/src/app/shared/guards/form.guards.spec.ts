import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { ConfirmDialogService } from '../components/ui/confirm-dialog/confirm-dialog.service';
import { DirtyAware, unsavedChangesGuard } from './form.guards';

describe('unsavedChangesGuard', () => {
  let confirm: jasmine.Spy;

  const run = (component: DirtyAware) =>
    TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({});
    confirm = spyOn(TestBed.inject(ConfirmDialogService), 'confirm');
  });

  it('lets an untouched form close without asking', () => {
    expect(run({ isDirty: () => false })).toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before discarding changes and follows the answer', async () => {
    confirm.and.resolveTo(false);
    expect(await run({ isDirty: () => true })).toBeFalse();

    confirm.and.resolveTo(true);
    expect(await run({ isDirty: () => true })).toBeTrue();
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
