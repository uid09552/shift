import { Component, ElementRef, HostListener, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SidebarService } from '../../services/sidebar.service';
import { GlobalSearchService } from '../../services/global-search.service';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ThemeToggleButtonComponent } from '../../components/common/theme-toggle/theme-toggle-button.component';
import { NotificationDropdownComponent } from '../../components/header/notification-dropdown/notification-dropdown.component';
import { UserDropdownComponent } from '../../components/header/user-dropdown/user-dropdown.component';
import { LanguageSwitcherComponent } from '../../components/common/language-switcher/language-switcher.component';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { CommandPaletteService, paletteShortcut } from '../../components/command-palette/command-palette.service';

@Component({
  selector: 'app-header',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ThemeToggleButtonComponent,
    NotificationDropdownComponent,
    UserDropdownComponent,
    LanguageSwitcherComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app-header.component.html',
})
export class AppHeaderComponent {
  isApplicationMenuOpen = false;
  readonly isMobileOpen$;
  searchQuery = '';
  readonly shortcutHint = paletteShortcut();

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('header') header!: ElementRef<HTMLElement>;

  /** Keeps `--app-header-height` true as the header wraps, so pages need not guess it. */
  private resizeObserver?: ResizeObserver;

  constructor(
    public sidebarService: SidebarService,
    private globalSearchService: GlobalSearchService,
    readonly palette: CommandPaletteService,
  ) {
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
  }

  handleToggle() {
    if (window.innerWidth >= 1280) {
      this.sidebarService.toggleExpanded();
    } else {
      this.sidebarService.toggleMobileOpen();
    }
  }

  toggleApplicationMenu() {
    this.isApplicationMenuOpen = !this.isApplicationMenuOpen;
  }

  ngAfterViewInit() {
    const header = this.header.nativeElement;
    this.publishHeight(header);
    this.resizeObserver = new ResizeObserver(() => this.publishHeight(header));
    this.resizeObserver.observe(header);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private publishHeight(header: HTMLElement) {
    document.documentElement.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
  }

  onSearch(term: string): void {
    this.globalSearchService.setSearchTerm(term);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.onSearch('');
  }

  /** `/` focuses the page filter, as in many web apps; Ctrl+K is the command palette. */
  @HostListener('document:keydown', ['$event'])
  onSlash(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
    }
  }
}
