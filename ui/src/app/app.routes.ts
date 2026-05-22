import { Routes } from '@angular/router';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { SignInComponent } from './pages/auth-pages/sign-in/sign-in.component';
import { SignUpComponent } from './pages/auth-pages/sign-up/sign-up.component';
import { KalenderComponent } from './pages/planner/kalender/kalender.component';
import { SchedulerComponent } from './pages/planner/scheduler/scheduler.component';
import { UserProfilesComponent } from './pages/planner/user-profiles/user-profiles.component';
import { ShiftsComponent } from './pages/configuration/shifts/shifts.component';
import { WorkstationsComponent } from './pages/configuration/workstations/workstations.component';
import { CapabilitiesComponent } from './pages/configuration/capabilities/capabilities.component';

export const routes: Routes = [
  {
    path:'',
    component:AppLayoutComponent,
    children:[
      {
        path: '',
        component: EcommerceComponent,
        pathMatch: 'full',
        title: 'ShiftPlanner - Dashboard',
      },
      {
        path:'kalender',
        component:KalenderComponent,
        title:'ShiftPlanner - Kalender'
      },
      {
        path:'scheduler',
        component:SchedulerComponent,
        title:'ShiftPlanner - Scheduler'
      },
      {
        path:'user-profiles',
        component:UserProfilesComponent,
        title:'ShiftPlanner - User Profiles'
      },
      {
        path:'shifts',
        component:ShiftsComponent,
        title:'ShiftPlanner - Shifts'
      },
      {
        path:'workstations',
        component:WorkstationsComponent,
        title:'ShiftPlanner - Workstations'
      },
      {
        path:'capabilities',
        component:CapabilitiesComponent,
        title:'ShiftPlanner - Capabilities'
      },
    ]
  },
  // auth pages
  {
    path:'signin',
    component:SignInComponent,
    title:'ShiftPlanner - Sign In'
  },
  {
    path:'signup',
    component:SignUpComponent,
    title:'ShiftPlanner - Sign Up'
  },
  // error pages
  {
    path:'**',
    component:NotFoundComponent,
    title:'ShiftPlanner - Page Not Found'
  },
];
