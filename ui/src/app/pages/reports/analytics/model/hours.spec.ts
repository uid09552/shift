import fixture from './hours.fixture.json';
import { decodeRosterFacts } from './facts';
import { emptyFilters, rosterRows } from './filter';
import { fiveNumbers, hoursByMonth, hoursByPerson } from './hours';
import { RosterFactsPayload } from '../../../../shared/services/analysis.service';

describe('hours and fairness', () => {
  const facts = decodeRosterFacts(fixture.facts as unknown as RosterFactsPayload);
  const all = Array.from({ length: facts.size }, (_, i) => i);
  const everyone = facts.employees.map((_, i) => i);

  it('totals each person exactly as the Fairness report does for the same rows', () => {
    const mine = hoursByPerson(facts, all, everyone).map((p) => ({
      employee_id: facts.employees[p.employee].id,
      shifts: p.shifts,
      hours: p.hours,
      target_hours: p.target,
      night_shifts: p.nights,
      weekend_days: p.weekendDays,
      weekends: p.weekends,
    }));
    const byId = (rows: { employee_id: string }[]) => [...rows].sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    expect(byId(mine)).toEqual(byId(fixture.fairness));
  });

  it('lists people with nothing, with zeros', () => {
    const carla = hoursByPerson(facts, all, everyone).find((p) => facts.employees[p.employee].name === 'Carla')!;
    expect(carla).toEqual(jasmine.objectContaining({ shifts: 0, hours: 0, target: null }));
  });

  it('counts holiday shifts and follows the filters', () => {
    const anna = facts.employees.findIndex((e) => e.name === 'Anna');
    const filters = { ...emptyFilters(), employee: [facts.employees[anna].id] };
    const rows = rosterRows(facts, filters, []);
    const [p] = hoursByPerson(facts, rows, [anna]);
    expect(p.holidayShifts).toBe(1);
    expect(hoursByMonth(facts, rows)).toEqual([{ month: '2026-09', hours: 38, nights: 2, weekendDays: 4, holidayShifts: 1 }]);
  });

  it('gives a box plot its five numbers', () => {
    expect(fiveNumbers([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(fiveNumbers([10])).toEqual([10, 10, 10, 10, 10]);
    expect(fiveNumbers([])).toEqual([0, 0, 0, 0, 0]);
  });
});
