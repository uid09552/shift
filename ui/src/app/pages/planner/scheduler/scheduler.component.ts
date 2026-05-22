import { Component } from '@angular/core';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';

@Component({
  selector: 'app-scheduler',
  standalone: true,
  imports: [PageBreadcrumbComponent],
  template: `
    <app-page-breadcrumb pageTitle="Scheduler" />

    <div
      class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6"
    >
      <h3 class="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90">
        Scheduler
      </h3>
      <p class="text-gray-500 dark:text-gray-400">
        Scheduler view for automated shift scheduling. Coming soon.
      </p>
    </div>
  `,
})
export class SchedulerComponent {}
