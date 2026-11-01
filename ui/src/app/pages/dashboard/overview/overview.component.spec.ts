import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Route, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { routes } from '../../../app.routes';
import { UserService } from '../../../shared/services/user.service';
import { OverviewComponent } from './overview.component';

describe('OverviewComponent', () => {
  function render(canPlan: boolean): HTMLElement {
    TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: UserService,
          useValue: { canPlan: () => of(canPlan), getSelf: () => of({}), hasRole: () => of(false), isAdmin: () => of(false) },
        },
      ],
    });
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('is the page at /', () => {
    const shell = routes.find((r) => r.path === '')!;
    const home = shell.children!.find((r: Route) => r.path === '' && r.pathMatch === 'full');
    expect(home?.component).toBe(OverviewComponent);
  });

  it('shows a planner the planner overview only', () => {
    const page = render(true);
    expect(page.querySelector('[data-testid="overview-page"] app-planner-overview')).not.toBeNull();
    expect(page.querySelector('app-viewer-overview')).toBeNull();
  });

  it('shows a viewer the viewer overview only', () => {
    const page = render(false);
    expect(page.querySelector('[data-testid="overview-page"] app-viewer-overview')).not.toBeNull();
    expect(page.querySelector('app-planner-overview')).toBeNull();
  });

  it('shows neither the setup counts nor the planned-hours chart', () => {
    for (const canPlan of [true, false]) {
      TestBed.resetTestingModule();
      const page = render(canPlan);
      expect(page.querySelector('[data-testid^="metric-"]')).toBeNull();
      expect(page.querySelector('[data-testid="overview-planned-hours"]')).toBeNull();
      expect(page.querySelector('apx-chart')).toBeNull();
    }
  });
});
