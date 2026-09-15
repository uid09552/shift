import { PreparedPlan, PreparedWorkstation } from '../../../shared/services/planner.service';
import { forecastCoverage } from './coverage-forecast';

// Mon 2026-09-07 … Sun 2026-09-13
const WEEK = { start_date: '2026-09-07', end_date: '2026-09-13' };
const WEEKDAYS = ['0', '1', '2', '3', '4'];

function shift(id: string, min: number, weekdays = WEEKDAYS) {
  return {
    id,
    name: id,
    is_night_shift: false,
    weekday_times: weekdays.map((weekday) => ({ weekday, start_time: '06:00', end_time: '14:00', min_employees: min })),
  };
}

function station(id: string, skills: string[], shifts: string[], min = 1, extra: Partial<PreparedWorkstation> = {}): PreparedWorkstation {
  return { id, name: id, required_skills: skills, priority: 'high', operating_shifts: shifts, min_employees: min, unavailability: [], ...extra };
}

function person(id: string, skills: string[], shifts: string[], absent: string[] = []) {
  return { id, name: id, skills, available_shifts: shifts, unavailability: absent };
}

function plan(overrides: Partial<PreparedPlan>): PreparedPlan {
  return { planning_period: WEEK, shifts: [], workstations: [], employees: [], capabilities: [], constraints: {}, ...overrides };
}

describe('forecastCoverage', () => {
  it('reads required as the larger of the shift minimum and the stations running it', () => {
    const forecast = forecastCoverage(plan({
      shifts: [shift('early', 3)],
      workstations: [station('ward', [], ['early'], 1), station('icu', [], ['early'], 1)],
      employees: [person('a', [], ['early']), person('b', [], ['early']), person('c', [], ['early']), person('d', [], ['early'])],
    }));

    const monday = forecast.rows[0].cells[0];
    expect(monday.required).toBe(3);
    expect(monday.available).toBe(4);
    expect(monday.level).toBe('ok');
    // Saturday: the shift does not run.
    expect(forecast.rows[0].cells[5].runs).toBeFalse();
  });

  it('marks a day short when fewer people could work it than it needs', () => {
    const forecast = forecastCoverage(plan({
      shifts: [shift('early', 2)],
      workstations: [station('ward', [], ['early'], 2)],
      employees: [person('a', [], ['early']), person('b', [], ['early'], ['2026-09-08'])],
    }));

    const [monday, tuesday] = forecast.rows[0].cells;
    expect(monday.level).toBe('tight');
    expect(tuesday.available).toBe(1);
    expect(tuesday.level).toBe('short');
    expect(forecast.shortDays).toBe(1);
  });

  it('counts only people who hold the station’s capabilities, or a higher level in the same group', () => {
    const forecast = forecastCoverage(plan({
      shifts: [shift('early', 1)],
      workstations: [station('icu', ['nurse-1'], ['early'])],
      employees: [person('junior', ['nurse-1'], ['early']), person('senior', ['nurse-2'], ['early']), person('porter', ['driving'], ['early'])],
      capabilities: [
        { id: 'nurse-1', level: 1, skill_group: 'nursing' },
        { id: 'nurse-2', level: 2, skill_group: 'nursing' },
        { id: 'driving', level: 1, skill_group: null },
      ],
    }));

    expect(forecast.rows[0].cells[0].available).toBe(2);
  });

  it('needs nobody at a closed station, and names a pair nobody can ever staff', () => {
    const forecast = forecastCoverage(plan({
      shifts: [shift('early', 1), shift('oncall', 1, ['5', '6'])],
      workstations: [
        station('ward', [], ['early'], 1, { unavailability: [{ from_date: '2026-09-08', to_date: '2026-09-08' }] }),
        station('er', ['emergency'], ['oncall']),
      ],
      employees: [person('icu-nurse', ['intensive'], ['early', 'oncall']), person('er-nurse', ['emergency'], ['early'])],
    }));

    const early = forecast.rows.find((r) => r.shiftId === 'early')!;
    expect(early.cells[1].required).toBe(0);
    expect(early.cells[1].level).toBe('none');

    expect(forecast.setupGaps).toEqual([
      { shiftName: 'oncall', workstationName: 'er', holdSkills: 1, workShift: 1 },
    ]);
  });

  it('caps capacity at the days-per-week limit', () => {
    const forecast = forecastCoverage(plan({
      shifts: [shift('early', 1, ['0', '1', '2', '3', '4', '5', '6'])],
      workstations: [station('ward', [], ['early'])],
      employees: [person('a', [], ['early'])],
      constraints: { max_working_days_per_week: 5 },
    }));

    expect(forecast.requiredShifts).toBe(7);
    expect(forecast.capacity).toBe(5);
  });
});
