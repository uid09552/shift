import { CommonModule } from '@angular/common';
import { Component, ElementRef, QueryList, ViewChildren, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { SidebarService } from '../../services/sidebar.service';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { SafeHtmlPipe } from '../../pipe/safe-html.pipe';
import { SidebarWidgetComponent } from './app-sidebar-widget.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { combineLatest, Subscription } from 'rxjs';
import { UserService } from '../../services/user.service';
import { NAV_ITEMS, NavItem } from './nav-items';

/** The URL without query string or fragment: `/scheduler?tab=runs` is still the scheduler's entry. */
/** The menu path a URL belongs to; a form page (`…/new`, `…/:id/edit`) counts as its list. */
function routePath(url: string): string {
  return url.split(/[?#]/)[0].replace(/\/(new|[^/]+\/edit)$/, '');
}

@Component({
  selector: 'app-sidebar',
  imports: [
    CommonModule,
    RouterModule,
    SafeHtmlPipe,
    SidebarWidgetComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app-sidebar.component.html',
})
export class AppSidebarComponent {

  // Main nav items — a copy, as entries the user may not open are dropped from it.
  navItems: NavItem[] = NAV_ITEMS.map((nav) => ({ ...nav, subItems: nav.subItems?.map((sub) => ({ ...sub })) }));
  openSubmenu: string | null | number = null;
  subMenuHeights: { [key: string]: number } = {};
  @ViewChildren('subMenu') subMenuRefs!: QueryList<ElementRef>;

  readonly isExpanded$;
  readonly isMobileOpen$;
  readonly isHovered$;

  private subscription: Subscription = new Subscription();

  constructor(
    public sidebarService: SidebarService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private userService: UserService
  ) {
    this.isExpanded$ = this.sidebarService.isExpanded$;
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.isHovered$ = this.sidebarService.isHovered$;
  }

  ngOnInit() {
    // Subscribe to router events
    this.subscription.add(
      this.router.events.subscribe(event => {
        if (event instanceof NavigationEnd) {
          this.setActiveMenuFromRoute(this.router.url);
        }
      })
    );

    // Subscribe to combined observables to close submenus when all are false
    this.subscription.add(
      combineLatest([this.isExpanded$, this.isMobileOpen$, this.isHovered$]).subscribe(
        ([isExpanded, isMobileOpen, isHovered]) => {
          if (!isExpanded && !isMobileOpen && !isHovered) {
            // this.openSubmenu = null;
            // this.savedSubMenuHeights = { ...this.subMenuHeights };
            // this.subMenuHeights = {};
            this.cdr.detectChanges();
          } else {
            // Restore saved heights when reopening
            // this.subMenuHeights = { ...this.savedSubMenuHeights };
            // this.cdr.detectChanges();
          }
        }
      )
    );

    // Admin-only entries are hidden rather than disabled: the backend rejects the
    // write anyway, so a non-admin has nothing to do on that screen.
    this.subscription.add(
      this.userService.isAdmin().subscribe(isAdmin => {
        if (!isAdmin) {
          this.hideItems(subItem => !!subItem.adminOnly);
          this.cdr.detectChanges();
        }
      })
    );
    // Planner-only entries (reports over everyone's data) the same way.
    this.subscription.add(
      this.userService.canPlan().subscribe(canPlan => {
        if (!canPlan) {
          this.hideItems(subItem => !!subItem.plannerOnly);
          this.cdr.detectChanges();
        }
      })
    );

    // Initial load
    this.setActiveMenuFromRoute(this.router.url);
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.subscription.unsubscribe();
  }

  private hideItems(hidden: (subItem: NonNullable<NavItem['subItems']>[number]) => boolean) {
    for (const nav of this.navItems) {
      if (nav.subItems) {
        nav.subItems = nav.subItems.filter(subItem => !hidden(subItem));
      }
    }
    this.navItems = this.navItems.filter(nav => !nav.subItems || nav.subItems.length > 0);
  }

  isActive(path: string): boolean {
    return routePath(this.router.url) === path;
  }

  toggleSubmenu(section: string, index: number) {
    const key = `${section}-${index}`;

    if (this.openSubmenu === key) {
      this.openSubmenu = null;
      this.subMenuHeights[key] = 0;
    } else {
      this.openSubmenu = key;

      setTimeout(() => {
        const el = document.getElementById(key);
        if (el) {
          this.subMenuHeights[key] = el.scrollHeight;
          this.cdr.detectChanges(); // Ensure UI updates
        }
      });
    }
  }

  onSidebarMouseEnter() {
    this.isExpanded$.subscribe(expanded => {
      if (!expanded) {
        this.sidebarService.setHovered(true);
      }
    }).unsubscribe();
  }

  private setActiveMenuFromRoute(currentUrl: string) {
    const menuGroups = [
      { items: this.navItems, prefix: 'main' },
    ];

    menuGroups.forEach(group => {
      group.items.forEach((nav, i) => {
        if (nav.subItems) {
          nav.subItems.forEach(subItem => {
            if (routePath(currentUrl) === subItem.path) {
              const key = `${group.prefix}-${i}`;
              this.openSubmenu = key;

              setTimeout(() => {
                const el = document.getElementById(key);
                if (el) {
                  this.subMenuHeights[key] = el.scrollHeight;
                  this.cdr.detectChanges(); // Ensure UI updates
                }
              });
            }
          });
        }
      });
    });
  }

  onSubmenuClick() {
    console.log('click submenu');
    this.isMobileOpen$.subscribe(isMobile => {
      if (isMobile) {
        this.sidebarService.setMobileOpen(false);
      }
    }).unsubscribe();
  }  

  
}
