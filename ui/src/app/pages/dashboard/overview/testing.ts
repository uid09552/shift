import { RosterFactsPayload } from '../../../shared/services/analysis.service';

/** Every weekday with the same bounds. */
const everyDay = (min: number) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, min, max: null }));

/**
 * Two days, one workstation (ICU) running a day shift (min 2) and a night
 * shift (min 1). `entries` are [date, employee, shift index].
 */
export function factsPayload(
  from: string,
  to: string,
  entries: [string, number, number][],
  closures: { from: string; to: string }[] = [],
): RosterFactsPayload {
  return {
    from_date: from,
    to_date: to,
    dims: {
      employees: [0, 1, 2].map((i) => ({ id: `e${i}`, name: `Person ${i}`, capabilities: [], weekly_hours: 40 })),
      capabilities: [],
      shifts: [
        { id: 'day', name: 'Day', short_name: 'D', color: '#465fff', is_night: false, weekday: everyDay(2) },
        { id: 'night', name: 'Night', short_name: 'N', color: '#101828', is_night: true, weekday: everyDay(1) },
      ],
      workstations: [
        { id: 'icu', name: 'ICU', available: true, active_shift_ids: ['day', 'night'], min: 1, max: null, closures },
      ],
      months: [],
      holidays: [],
    },
    rows: {
      date: entries.map((e) => e[0]),
      employee: entries.map((e) => e[1]),
      shift: entries.map((e) => e[2]),
      workstation: entries.map(() => 0),
      present: entries.map(() => true),
      absence: entries.map(() => null),
      creation: entries.map(() => 'manual'),
      hours: entries.map(() => 8),
      night: entries.map((e) => e[2] === 1),
      weekend: entries.map(() => null),
      holiday: entries.map(() => false),
    },
  };
}
