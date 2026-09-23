import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

export interface TabItem {
  /** Stable key — also what a deep link stores, so keep it URL-friendly. */
  id: string;
  label: string;
  /** Short count or value shown beside the label: what the tab holds, without opening it. */
  badge?: string | number | null;
  disabled?: boolean;
}

/**
 * A tab bar for switching between sections of one screen.
 *
 * Underlined tabs, deliberately distinct from the segmented pill controls used
 * for view modes (week/month, grouping): those change how one thing is drawn,
 * these change which thing you are looking at.
 *
 * Follows the ARIA tabs pattern — one stop in the tab order, arrows to move
 * between tabs — so the panel content stays reachable in one Tab press. The
 * caller renders the panel and owns the `id`s referenced here.
 */
@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      role="tablist"
      [attr.aria-label]="ariaLabel"
      class="tablist flex items-center gap-1"
      (keydown)="onKeydown($event)"
    >
      @for (tab of tabs; track tab.id; let i = $index) {
        <button
          type="button"
          role="tab"
          [id]="tabId(tab)"
          [attr.aria-controls]="panelId(tab)"
          [attr.aria-selected]="tab.id === active"
          [attr.tabindex]="tab.id === active ? 0 : -1"
          [disabled]="tab.disabled"
          (click)="select(tab)"
          class="-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40"
          [class]="tab.id === active
            ? 'border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-400'
            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-200'"
        >
          {{ tab.label }}
          @if (tab.badge !== null && tab.badge !== undefined && tab.badge !== '') {
            <span
              class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
              [class]="tab.id === active
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
                : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'"
            >
              {{ tab.badge }}
            </span>
          }
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* Scrolls sideways when the labels outgrow the width. overflow-y is pinned
       to hidden because leaving it visible makes the browser compute it as
       auto — which puts a stray vertical scrollbar next to the tabs. */
    .tablist {
      overflow-x: auto;
      overflow-y: hidden;
      /* Room for the active tab's 1px overhang onto the divider below. */
      padding-bottom: 1px;
      scrollbar-width: none;
    }

    .tablist::-webkit-scrollbar {
      display: none;
    }
  `,
})
export class TabsComponent {
  @Input() tabs: TabItem[] = [];
  @Input() active = '';
  @Input() ariaLabel = '';
  /** Prefix for the generated ids, so two tab bars on one page stay distinct. */
  @Input() idPrefix = 'tab';

  @Output() activeChange = new EventEmitter<string>();

  tabId(tab: TabItem): string {
    return `${this.idPrefix}-${tab.id}`;
  }

  panelId(tab: TabItem): string {
    return `${this.idPrefix}-panel-${tab.id}`;
  }

  select(tab: TabItem): void {
    if (tab.disabled || tab.id === this.active) return;
    this.activeChange.emit(tab.id);
  }

  /** Arrow keys move between tabs, Home/End jump to the ends — the ARIA pattern. */
  onKeydown(event: KeyboardEvent): void {
    const enabled = this.tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;

    const current = enabled.findIndex((t) => t.id === this.active);
    let next = -1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const tab = enabled[next];
    this.activeChange.emit(tab.id);
    // The newly selected tab is the only one in the tab order, so move focus
    // with the selection — otherwise the next Tab press leaves the bar.
    queueMicrotask(() => document.getElementById(this.tabId(tab))?.focus());
  }
}
