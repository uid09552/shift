/** The sidebar's entries; the command palette offers the same pages. */
export type NavItem = {
  /** Translation key of the entry's label, e.g. `nav.schedule`. */
  name: string;
  icon: string;
  path?: string;
  new?: boolean;
  /**
   * `adminOnly` entries are dropped for anyone without the `shift-admin` role,
   * `plannerOnly` ones for anyone who cannot plan (`shift-viewer`). A group
   * left without entries is dropped too.
   */
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean; adminOnly?: boolean; plannerOnly?: boolean }[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V8.99998C3.25 10.2426 4.25736 11.25 5.5 11.25H9C10.2426 11.25 11.25 10.2426 11.25 8.99998V5.5C11.25 4.25736 10.2426 3.25 9 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H9C9.41421 4.75 9.75 5.08579 9.75 5.5V8.99998C9.75 9.41419 9.41421 9.74998 9 9.74998H5.5C5.08579 9.74998 4.75 9.41419 4.75 8.99998V5.5ZM5.5 12.75C4.25736 12.75 3.25 13.7574 3.25 15V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H9C10.2426 20.75 11.25 19.7427 11.25 18.5V15C11.25 13.7574 10.2426 12.75 9 12.75H5.5ZM4.75 15C4.75 14.5858 5.08579 14.25 5.5 14.25H9C9.41421 14.25 9.75 14.5858 9.75 15V18.5C9.75 18.9142 9.41421 19.25 9 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V15ZM12.75 5.5C12.75 4.25736 13.7574 3.25 15 3.25H18.5C19.7426 3.25 20.75 4.25736 20.75 5.5V8.99998C20.75 10.2426 19.7426 11.25 18.5 11.25H15C13.7574 11.25 12.75 10.2426 12.75 8.99998V5.5ZM15 4.75C14.5858 4.75 14.25 5.08579 14.25 5.5V8.99998C14.25 9.41419 14.5858 9.74998 15 9.74998H18.5C18.9142 9.74998 19.25 9.41419 19.25 8.99998V5.5C19.25 5.08579 18.9142 4.75 18.5 4.75H15ZM15 12.75C13.7574 12.75 12.75 13.7574 12.75 15V18.5C12.75 19.7426 13.7574 20.75 15 20.75H18.5C19.7426 20.75 20.75 19.7427 20.75 18.5V15C20.75 13.7574 19.7426 12.75 18.5 12.75H15ZM14.25 15C14.25 14.5858 14.5858 14.25 15 14.25H18.5C18.9142 14.25 19.25 14.5858 19.25 15V18.5C19.25 18.9142 18.9142 19.25 18.5 19.25H15C14.5858 19.25 14.25 18.9142 14.25 18.5V15Z" fill="currentColor"></path></svg>`,
    name: "nav.dashboard",
    subItems: [
      { name: "nav.overview", path: "/" },
    ],
  },
  {
    name: "nav.configuration",
    icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H18.5001C19.7427 20.75 20.7501 19.7426 20.7501 18.5V5.5C20.7501 4.25736 19.7427 3.25 18.5001 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H18.5001C18.9143 4.75 19.2501 5.08579 19.2501 5.5V18.5C19.2501 18.9142 18.9143 19.25 18.5001 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V5.5ZM6.25005 9.7143C6.25005 9.30008 6.58583 8.9643 7.00005 8.9643L17 8.96429C17.4143 8.96429 17.75 9.30008 17.75 9.71429C17.75 10.1285 17.4143 10.4643 17 10.4643L7.00005 10.4643C6.58583 10.4643 6.25005 10.1285 6.25005 9.7143ZM6.25005 14.2857C6.25005 13.8715 6.58583 13.5357 7.00005 13.5357H17C17.4143 13.5357 17.75 13.8715 17.75 14.2857C17.75 14.6999 17.4143 15.0357 17 15.0357H7.00005C6.58583 15.0357 6.25005 14.6999 6.25005 14.2857Z" fill="currentColor"></path></svg>`,
    subItems: [
      { name: "nav.userProfiles", path: "/user-profiles", pro: false },
      { name: "nav.shifts", path: "/shifts", pro: false },
      { name: "nav.workstations", path: "/workstations", pro: false },
      { name: "nav.capabilities", path: "/capabilities", pro: false },
      { name: "nav.plannerSettings", path: "/planner-settings", pro: false },
      { name: "nav.staffingRules", path: "/staffing-rules", pro: false, plannerOnly: true },
      { name: "nav.wishSettings", path: "/wish-settings", pro: false, adminOnly: true },
      { name: "nav.users", path: "/users", pro: false, adminOnly: true },
      { name: "nav.notifications", path: "/notifications", pro: false },
      { name: "nav.auditLog", path: "/audit-log", pro: false }
    ],
  },
  {
    name: "nav.planner",
    icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M7 2C7.41421 2 7.75 2.33579 7.75 2.75V4.5H16.25V2.75C16.25 2.33579 16.5858 2 17 2C17.4142 2 17.75 2.33579 17.75 2.75V4.5H19C20.1046 4.5 21 5.39543 21 6.5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V6.5C3 5.39543 3.89543 4.5 5 4.5H6.25V2.75C6.25 2.33579 6.58579 2 7 2ZM6.25 6H5C4.72386 6 4.5 6.22386 4.5 6.5V10H19.5V6.5C19.5 6.22386 19.2761 6 19 6H17.75V7.25C17.75 7.66421 17.4142 8 17 8C16.5858 8 16.25 7.66421 16.25 7.25V6H7.75V7.25C7.75 7.66421 7.41421 8 7 8C6.58579 8 6.25 7.66421 6.25 7.25V6ZM19.5 11.5H4.5V19C4.5 19.2761 4.72386 19.5 5 19.5H19C19.2761 19.5 19.5 19.2761 19.5 19V11.5ZM9 13.75C9 13.3358 9.33579 13 9.75 13H14.25C14.6642 13 15 13.3358 15 13.75C15 14.1642 14.6642 14.5 14.25 14.5H9.75C9.33579 14.5 9 14.1642 9 13.75Z" fill="currentColor"></path></svg>`,
    subItems: [
      { name: "nav.schedule", path: "/kalender", pro: false },
      { name: "nav.changes", path: "/changes", pro: false },
      { name: "nav.leave", path: "/leave", pro: false },
      { name: "nav.openShifts", path: "/open-shifts", pro: false },
      { name: "nav.employeeCalendar", path: "/employee-calendar", pro: false },
      { name: "nav.rotations", path: "/rotations", pro: false },
      { name: "nav.scheduleOptimizer", path: "/scheduler", pro: false },
      { name: "nav.fairness", path: "/fairness", pro: false }
    ],
  },
  {
    name: "nav.reports",
    icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6" cy="6" r="2.25"/><circle cx="18" cy="8" r="2.25"/><circle cx="9" cy="18" r="2.25"/><path d="M8.1 6.4 15.8 7.6M7 8.1l1.4 7.7M16.4 9.7l-5.6 6.6"/></g></svg>`,
    subItems: [
      { name: "nav.ontology", path: "/ontology", pro: false, plannerOnly: true },
      { name: "nav.analytics", path: "/analytics", pro: false, plannerOnly: true }
    ],
  },
];
