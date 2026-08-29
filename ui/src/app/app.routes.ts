import { Routes } from '@angular/router';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { SignInComponent } from './pages/auth-pages/sign-in/sign-in.component';
import { SignUpComponent } from './pages/auth-pages/sign-up/sign-up.component';
import { KalenderComponent } from './pages/planner/kalender/kalender.component';
import { EmployeeCalendarComponent } from './pages/planner/employee-calendar/employee-calendar.component';
import { WorkstationCalendarComponent } from './pages/planner/workstation-calendar/workstation-calendar.component';
import { SchedulerComponent } from './pages/planner/scheduler/scheduler.component';
import { UserProfilesComponent } from './pages/planner/user-profiles/user-profiles.component';
import { ShiftsComponent } from './pages/configuration/shifts/shifts.component';
import { WorkstationsComponent } from './pages/configuration/workstations/workstations.component';
import { CapabilitiesComponent } from './pages/configuration/capabilities/capabilities.component';
import { PlannerSettingsComponent } from './pages/configuration/planner-settings/planner-settings.component';
import { WishSettingsComponent } from './pages/configuration/wish-settings/wish-settings.component';

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
        path:'user-profiles',
        component:UserProfilesComponent,
        title:'title.userProfiles'
      },
      {
        path:'shifts',
        component:ShiftsComponent,
        title:'title.shifts'
      },
      {
        path:'workstations',
        component:WorkstationsComponent,
        title:'title.workstations'
      },
      {
        path:'capabilities',
        component:CapabilitiesComponent,
        title:'title.capabilities'
      },
      {
        path:'workstation-calendar',
        component:WorkstationCalendarComponent,
        title:'title.workstationCalendar'
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
    ]
  },
  // auth pages
  {
    path:'signin',
    component:SignInComponent,
    title:'title.signIn'
  },
  {
    path:'signup',
    component:SignUpComponent,
    title:'title.signUp'
  },
  // error pages
  {
    path:'**',
    component:NotFoundComponent,
    title:'title.notFound'
  },
];
