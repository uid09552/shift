import { Routes } from '@angular/router';
import { adminGuard, unsavedChangesGuard, writerGuard } from './shared/guards/form.guards';
import { ShiftFormComponent } from './pages/configuration/shifts/shift-form.component';
import { WorkstationFormComponent } from './pages/configuration/workstations/workstation-form.component';
import { EmployeeFormComponent } from './pages/planner/user-profiles/employee-form.component';
import { UserFormComponent } from './pages/configuration/users/user-form.component';
import { CapabilityFormComponent } from './pages/configuration/capabilities/capability-form.component';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { KalenderComponent } from './pages/planner/kalender/kalender.component';
import { EmployeeCalendarComponent } from './pages/planner/employee-calendar/employee-calendar.component';
import { SchedulerComponent } from './pages/planner/scheduler/scheduler.component';
import { FairnessComponent } from './pages/planner/fairness/fairness.component';
import { RotationsComponent } from './pages/planner/rotations/rotations.component';
import { UserProfilesComponent } from './pages/planner/user-profiles/user-profiles.component';
import { ShiftsComponent } from './pages/configuration/shifts/shifts.component';
import { WorkstationsComponent } from './pages/configuration/workstations/workstations.component';
import { CapabilitiesComponent } from './pages/configuration/capabilities/capabilities.component';
import { PlannerSettingsComponent } from './pages/configuration/planner-settings/planner-settings.component';
import { WishSettingsComponent } from './pages/configuration/wish-settings/wish-settings.component';
import { AuditLogComponent } from './pages/configuration/audit-log/audit-log.component';
import { UsersComponent } from './pages/configuration/users/users.component';
import { ChangesComponent } from './pages/planner/changes/changes.component';

export const routes: Routes = [
  {
    path:'',
    component:AppLayoutComponent,
    children:[
      {
        path: '',
        component: EcommerceComponent,
        pathMatch: 'full',
        title: 'title.dashboard',
      },
      {
        path:'kalender',
        component:KalenderComponent,
        title:'title.schedule'
      },
      {
        // The day view is the Schedule page's Day view now. Kept as a redirect
        // so old links and bookmarks still open it.
        path:'day-view',
        redirectTo:'/kalender?view=day',
        pathMatch:'full'
      },
      {
        path:'employee-calendar',
        component:EmployeeCalendarComponent,
        title:'title.employeeCalendar'
      },
      {
        path:'scheduler',
        component:SchedulerComponent,
        title:'title.scheduleOptimizer'
      },
      {
        // Changes to published rosters: everyone's own, and for planners the
        // ward's changes nobody has acknowledged yet.
        path:'changes',
        component:ChangesComponent,
        title:'title.changes'
      },
      {
        path:'rotations',
        component:RotationsComponent,
        title:'title.rotations'
      },
      {
        path:'fairness',
        component:FairnessComponent,
        title:'title.fairness'
      },
      {
        path:'user-profiles',
        component:UserProfilesComponent,
        title:'title.userProfiles'
      },
      {
        path:'user-profiles/new',
        component:EmployeeFormComponent,
        title:'title.userProfiles',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/user-profiles' }
      },
      {
        path:'user-profiles/:id/edit',
        component:EmployeeFormComponent,
        title:'title.userProfiles',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/user-profiles' }
      },
      {
        path:'shifts',
        component:ShiftsComponent,
        title:'title.shifts'
      },
      {
        path:'shifts/new',
        component:ShiftFormComponent,
        title:'title.shifts',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/shifts' }
      },
      {
        path:'shifts/:id/edit',
        component:ShiftFormComponent,
        title:'title.shifts',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/shifts' }
      },
      {
        path:'workstations',
        component:WorkstationsComponent,
        title:'title.workstations'
      },
      {
        path:'workstations/new',
        component:WorkstationFormComponent,
        title:'title.workstations',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/workstations' }
      },
      {
        path:'workstations/:id/edit',
        component:WorkstationFormComponent,
        title:'title.workstations',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/workstations' }
      },
      {
        path:'capabilities',
        component:CapabilitiesComponent,
        title:'title.capabilities'
      },
      {
        path:'capabilities/new',
        component:CapabilityFormComponent,
        title:'title.capabilities',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/capabilities' }
      },
      {
        path:'capabilities/:id/edit',
        component:CapabilityFormComponent,
        title:'title.capabilities',
        canActivate:[writerGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/capabilities' }
      },
      {
        // The standalone workstation calendar was a read-only week of what the
        // Schedule page already shows under "By workstation", over the same
        // confirmed plans. Kept as a redirect so old links and the assistant's
        // `navigate` page name still land somewhere sensible.
        path:'workstation-calendar',
        redirectTo:'kalender',
        pathMatch:'full'
      },
      {
        path:'planner-settings',
        component:PlannerSettingsComponent,
        title:'title.plannerSettings'
      },
      {
        path:'wish-settings',
        component:WishSettingsComponent,
        title:'title.wishSettings'
      },
      {
        path:'users',
        component:UsersComponent,
        title:'title.users'
      },
      {
        path:'users/new',
        component:UserFormComponent,
        title:'title.users',
        canActivate:[adminGuard],
        canDeactivate:[unsavedChangesGuard],
        data:{ listPath:'/users' }
      },
      {
        path:'audit-log',
        component:AuditLogComponent,
        title:'title.auditLog'
      },
    ]
  },
  // error pages
  {
    path:'**',
    component:NotFoundComponent,
    title:'title.notFound'
  },
];
