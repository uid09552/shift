import { Routes } from '@angular/router';
import { Planner } from './planner/planner';
import { Account } from './account/account';

export const routes: Routes = [
  { path: 'planner', component: Planner },
  { path: 'account', component: Account },
  { path: '', redirectTo: '/planner', pathMatch: 'full' },
];
