import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { AvailabilityRulesService, CapabilityExpiry } from '../../../shared/services/availability-rules.service';
import { UserService } from '../../../shared/services/user.service';

/** Capabilities that have lapsed or lapse within 60 days — for planners, above the employee list. */
@Component({
  selector: 'app-capability-expiry-warnings',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (rows.length) {
      <div class="mb-5 rounded-2xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10" data-testid="capability-expiry-warnings">
        <p class="text-sm font-medium text-warning-800 dark:text-warning-300">{{ 'expiry.warningsTitle' | t: { count: rows.length } }}</p>
        <ul class="mt-2 space-y-1 text-sm text-warning-800 dark:text-warning-300">
          @for (r of rows.slice(0, 8); track r.employee_id + r.capability_id) {
            <li [attr.data-testid]="'capability-expiry-warning-' + r.employee_id">
              <a [routerLink]="['/user-profiles', r.employee_id, 'edit']" class="font-medium underline">{{ r.employee_name }}</a>
              · {{ r.capability_name }} ·
              {{ (r.expired ? 'expiry.expiredOn' : 'expiry.lapsesIn') | t: { date: r.valid_until, days: r.days_left } }}
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class CapabilityExpiryWarningsComponent implements OnInit {
  rows: CapabilityExpiry[] = [];

  constructor(private service: AvailabilityRulesService, private users: UserService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.users.canPlan().subscribe((canPlan) => {
      if (!canPlan) return;
      this.service.expiries(60).subscribe({
        next: (rows) => {
          this.rows = rows;
          this.cdr.markForCheck();
        },
        error: () => undefined, // a warning panel that cannot load simply stays away
      });
    });
  }
}
