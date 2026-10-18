import { ShiftRole } from '../../../shared/services/organization-user.service';

/** The roles as they are offered, each with the sentence explaining what it buys. */
export const ROLE_OPTIONS: { value: ShiftRole; label: string; hint: string }[] = [
  { value: 'shift-admin', label: 'users.role.admin', hint: 'users.role.adminHint' },
  { value: 'shift-planner', label: 'users.role.planner', hint: 'users.role.plannerHint' },
  { value: 'shift-viewer', label: 'users.role.viewer', hint: 'users.role.viewerHint' },
];
