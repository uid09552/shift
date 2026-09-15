import { EmployeeFairness } from '../../../shared/services/analysis.service';
import { presetRange } from './fairness.component';
import { sortRows, targetDelta, teamSpread } from './fairness-stats';

function row(name: string, over: Partial<EmployeeFairness> = {}): EmployeeFairness {
  return {
    employee_id: name,
    employee_name: name,
    shifts: 10,
    hours: 80,
    target_hours: 80,
    night_shifts: 0,
    weekend_days: 0,
    weekends: 0,
    wishes_asked: 0,
    wishes_granted: 0,
    days_absent: 0,
    ...over,
  };
}

describe('fairness stats', () => {
  it('sorts by any figure, most first, with missing values last', () => {
    const rows = [
      row('Anna', { night_shifts: 2, wishes_asked: 2, wishes_granted: 1 }),
      row('Ben', { night_shifts: 5 }),
      row('Carl', { night_shifts: 5, wishes_asked: 1, wishes_granted: 1 }),
    ];

    expect(sortRows(rows, 'night_shifts', 'desc').map((r) => r.employee_name)).toEqual(['Ben', 'Carl', 'Anna']);
    // Ben asked for nothing: no rate, so last whichever way round.
    expect(sortRows(rows, 'wishes', 'desc').map((r) => r.employee_name)).toEqual(['Carl', 'Anna', 'Ben']);
    expect(sortRows(rows, 'wishes', 'asc').map((r) => r.employee_name)).toEqual(['Anna', 'Carl', 'Ben']);
  });

  it('reads hours against the target, and nothing without one', () => {
    expect(targetDelta(row('Anna', { hours: 92.5, target_hours: 80 }))).toBe(12.5);
    expect(targetDelta(row('Ben', { target_hours: null }))).toBeNull();
  });

  it('measures the spread among people who worked, not those with nothing', () => {
    const team = teamSpread([
      row('Anna', { night_shifts: 2, hours: 70 }),
      row('Ben', { night_shifts: 6, hours: 90 }),
      row('Carl', { shifts: 0, hours: 0, night_shifts: 0 }), // on leave all month
    ]);

    expect(team.working).toBe(2);
    expect(team.nights).toEqual({ min: 2, max: 6, avg: 4 });
    expect(team.hours).toEqual({ min: 70, max: 90, avg: 80 });
    expect(team.targetDelta).toEqual({ min: -10, max: 10, avg: 0 });
  });

  it('turns presets into calendar periods', () => {
    const today = new Date(2026, 8, 15); // 15 Sep 2026
    expect(presetRange('thisMonth', today)).toEqual(['2026-09-01', '2026-09-30']);
    expect(presetRange('lastMonth', today)).toEqual(['2026-08-01', '2026-08-31']);
    expect(presetRange('thisQuarter', today)).toEqual(['2026-07-01', '2026-09-30']);
    expect(presetRange('last3Months', today)).toEqual(['2026-07-01', '2026-09-30']);
    // Across a year boundary.
    expect(presetRange('lastMonth', new Date(2027, 0, 10))).toEqual(['2026-12-01', '2026-12-31']);
  });
});
