import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { UserService } from '../../../shared/services/user.service';
import { PlannerOverviewComponent } from './planner-overview.component';
import { ViewerOverviewComponent } from './viewer-overview.component';

/**
 * The page at `/`. The role decides which overview renders, and only that one
 * is created — so a viewer's overview cannot request what is a planner's to see.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [PlannerOverviewComponent, ViewerOverviewComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div data-testid="overview-page">
      @if (canPlan === true) {
        <app-planner-overview />
      } @else if (canPlan === false) {
        <app-viewer-overview />
      }
    </div>
  `,
})
export class OverviewComponent implements OnInit {
  /** Null until `/self` has answered. */
  canPlan: boolean | null = null;

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.userService.canPlan().subscribe((canPlan) => (this.canPlan = canPlan));
  }
}
