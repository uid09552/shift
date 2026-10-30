import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';

import { routes } from '../../../app.routes';
import { writerGuard } from '../../../shared/guards/form.guards';
import { AppSidebarComponent } from '../../../shared/layout/app-sidebar/app-sidebar.component';
import { UserService } from '../../../shared/services/user.service';

/** The analytics route among the app's routes, wherever it is nested. */
function findRoute(list: Route[], path: string): Route | undefined {
  for (const route of list) {
    if (route.path === path) return route;
    const found = route.children && findRoute(route.children, path);
    if (found) return found;
  }
  return undefined;
}

describe('Analytics access', () => {
  const asRole = (canPlan: boolean) => {
    TestBed.configureTestingModule({
      imports: [AppSidebarComponent],
      providers: [
        provideRouter([]),
        { provide: UserService, useValue: { canPlan: () => of(canPlan), isAdmin: () => of(false) } },
      ],
    });
  };

  it('is a lazy route behind the writer guard that sends others to the overview', () => {
    const route = findRoute(routes, 'analytics')!;
    expect(route).toBeDefined();
    expect(route.loadComponent).toBeDefined();
    expect(route.canActivate).toContain(writerGuard);
    expect(route.data?.['listPath']).toBe('/');
  });

  it('redirects a viewer to the overview', async () => {
    asRole(false);
    const route = { data: findRoute(routes, 'analytics')!.data } as unknown as ActivatedRouteSnapshot;
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(
        () => writerGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>,
      ),
    );
    expect(result instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });

  it('lets a planner in', async () => {
    asRole(true);
    const route = { data: findRoute(routes, 'analytics')!.data } as unknown as ActivatedRouteSnapshot;
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(
        () => writerGuard(route, {} as RouterStateSnapshot) as Observable<boolean | UrlTree>,
      ),
    );
    expect(result).toBeTrue();
  });

  const reportPaths = (canPlan: boolean): string[] => {
    asRole(canPlan);
    const fixture = TestBed.createComponent(AppSidebarComponent);
    fixture.detectChanges();
    const reports = fixture.componentInstance.navItems.find((n) => n.name === 'nav.reports');
    return (reports?.subItems ?? []).map((s) => s.path);
  };

  it('shows Analytics next to the network page in a planner\'s Reports menu', () => {
    expect(reportPaths(true)).toEqual(['/relationships', '/analytics']);
  });

  it('hides it from a viewer', () => {
    expect(reportPaths(false)).not.toContain('/analytics');
  });
});
