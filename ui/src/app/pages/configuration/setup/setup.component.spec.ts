import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SetupComponent } from './setup.component';
import { SetupBannerComponent } from '../../dashboard/overview/setup-banner.component';
import { ConfirmDialogService } from '../../../shared/components/ui/confirm-dialog/confirm-dialog.service';
import { checklistDismissed, setChecklistDismissed, SetupStatus } from '../../../shared/services/setup.service';

const IDS = ['shifts', 'capabilities', 'workstations', 'employees', 'planner_settings', 'first_plan'] as const;
const status = (done: number, sample = false): SetupStatus => ({
  steps: IDS.map((id, i) => ({ id, count: i < done ? 2 : 0, done: i < done })),
  complete: done === IDS.length,
  sample_data_available: sample,
});

describe('Setup guide', () => {
  let http: HttpTestingController;
  const statusRequest = () => http.expectOne((r) => r.url.endsWith('/setup-status'));

  beforeEach(() => setChecklistDismissed(false));
  afterEach(() => setChecklistDismissed(false));

  describe('SetupComponent', () => {
    let fixture: ComponentFixture<SetupComponent>;
    const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

    function open(confirm = true) {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: ConfirmDialogService, useValue: { confirm: () => Promise.resolve(confirm) } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(SetupComponent);
      fixture.detectChanges();
    }

    it('lists the six steps in order, each linking to where it is done, the next one marked', () => {
      open();
      statusRequest().flush(status(2));
      fixture.detectChanges();
      expect(query('[data-testid="setup-progress"]')!.textContent).toContain('2 of 6');
      const steps = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="setup-step-"]')) as HTMLElement[];
      expect(steps.map((s) => s.dataset['testid'])).toEqual(IDS.map((id) => `setup-step-${id}`));
      expect(query('[data-testid="setup-step-workstations"]')!.getAttribute('aria-current')).toBe('step');
      expect(query('[data-testid="setup-add-workstations"]')!.getAttribute('href')).toBe('/workstations/new');
      expect(query('[data-testid="setup-add-shifts"]')).toBeNull(); // done: no "add" button
      expect(query('[data-testid="setup-open-employees"]')!.getAttribute('href')).toBe('/user-profiles');
      expect(query('[data-testid="setup-open-first_plan"]')!.getAttribute('href')).toBe('/scheduler');
      expect(query('[data-testid="setup-sample-data"]')).toBeNull();
    });

    it('loads sample data into an empty organization after asking', async () => {
      open();
      statusRequest().flush(status(0, true));
      fixture.detectChanges();
      (query('[data-testid="setup-sample-data"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/setup/sample-data')).flush(status(4));
      fixture.detectChanges();
      expect(query('[data-testid="setup-progress"]')!.textContent).toContain('4 of 6');
      expect(query('[data-testid="setup-sample-data"]')).toBeNull();
    });

    it('turns the overview banner off and on again', () => {
      open();
      statusRequest().flush(status(1));
      fixture.detectChanges();
      const box = query('[data-testid="setup-show-on-overview"]') as HTMLInputElement;
      expect(box.checked).toBeTrue();
      box.click();
      expect(checklistDismissed()).toBeTrue();
      box.click();
      expect(checklistDismissed()).toBeFalse();
    });
  });

  describe('SetupBannerComponent', () => {
    let fixture: ComponentFixture<SetupBannerComponent>;
    const banner = () => fixture.nativeElement.querySelector('[data-testid="setup-banner"]');

    function open(roles: string[]) {
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
      http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(SetupBannerComponent);
      fixture.detectChanges();
      http.expectOne((r) => r.url.endsWith('/self')).flush({ roles });
      fixture.detectChanges();
    }

    it('shows admins how far setup is, until they hide it', () => {
      open(['shift-admin']);
      statusRequest().flush(status(3));
      fixture.detectChanges();
      expect(banner().textContent).toContain('3 of 6');
      expect(banner().textContent).toContain('Employees');
      (fixture.nativeElement.querySelector('[data-testid="setup-banner-dismiss"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(banner()).toBeNull();
      expect(checklistDismissed()).toBeTrue();
    });

    it('is not shown to planners, nor once setup is complete', () => {
      open(['shift-planner']);
      http.expectNone((r) => r.url.endsWith('/setup-status'));
      expect(banner()).toBeNull();

      TestBed.resetTestingModule();
      open(['shift-admin']);
      statusRequest().flush(status(6));
      fixture.detectChanges();
      expect(banner()).toBeNull();
    });
  });
});
