import fixture from './coverage.fixture.json';
import { dayNumber, isoDay } from './dates';
import { coverage, CoverageCell } from './coverage';
import { RosterFacts, decodeRosterFacts } from './facts';
import { rosterPayload } from './testing';

/** The fixture as the roster-facts endpoint would send it. */
function fixtureFacts(): RosterFacts {
  const shiftIds = fixture.shifts.map((s) => s.id);
  const stationIds = fixture.workstations.map((w) => w.id);
  return decodeRosterFacts(
    rosterPayload(
      fixture.period.from,
      fixture.period.to,
      {
        employees: fixture.employees.map((id) => ({ id, name: id, capabilities: [], weekly_hours: 40 })),
        shifts: fixture.shifts.map((s) => ({ id: s.id, name: s.name, short_name: 'E', color: '#000', is_night: false, weekday: s.weekday })),
        workstations: fixture.workstations,
        holidays: fixture.holidays,
      },
      fixture.assignments.map((a) => ({
        date: a.date,
        employee: fixture.employees.indexOf(a.employee),
        shift: shiftIds.indexOf(a.shift),
        workstation: stationIds.indexOf(a.workstation),
      })),
    ),
  );
}

describe('coverage (the plan check\'s staffing rules)', () => {
  const facts = fixtureFacts();
  const all = Array.from({ length: facts.size }, (_, i) => i);
  const result = coverage(facts, all, { shifts: null, workstations: null, days: null });

  const shiftRow = (c: CoverageCell) => ({ date: isoDay(c.day), shift: facts.shifts[c.shift].id, staffed: c.staffed });
  const stationRow = (c: CoverageCell) => ({ ...shiftRow(c), workstation: facts.workstations[c.workstation].id });

  it('finds the same shift shortfalls as the plan check', () => {
    const short = result.shiftCells.filter((c) => c.short > 0).map((c) => ({ ...shiftRow(c), min: c.min }));
    expect(short).toEqual(fixture.expected.shift_under_min);
  });

  it('finds the same workstation shortfalls, skipping the closed station', () => {
    const short = result.workstationCells.filter((c) => c.short > 0).map((c) => ({ ...stationRow(c), min: c.min }));
    expect(short).toEqual(fixture.expected.workstation_under_min);
    const erAfterClosure = result.workstationCells.filter(
      (c) => facts.workstations[c.workstation].id === 'er' && c.day >= dayNumber('2026-09-14'),
    );
    expect(erAfterClosure).toEqual([]);
  });

  it('finds the same days over the maximum', () => {
    const shiftOver = result.shiftCells.filter((c) => c.over > 0).map((c) => ({ ...shiftRow(c), max: c.max }));
    const stationOver = result.workstationCells.filter((c) => c.over > 0).map((c) => ({ ...stationRow(c), max: c.max }));
    expect(shiftOver).toEqual(fixture.expected.shift_over_max);
    expect(stationOver).toEqual(fixture.expected.workstation_over_max);
  });

  it('gives a weekday holiday the Sunday minimum', () => {
    const holiday = result.shiftCells.find((c) => isoDay(c.day) === '2026-09-16')!;
    expect(holiday.min).toBe(3);
  });

  it('sums each day and each shift and workstation', () => {
    const saturday = result.days.find((d) => isoDay(d.day) === '2026-09-12')!;
    expect(saturday).toEqual(jasmine.objectContaining({ staffed: 1, min: 2, short: 1 }));
    expect(result.shortByShift).toEqual([3]);
    expect(result.shortByWorkstation).toEqual([0, 1]);
  });

  it('switches the daily totals to workstation level when narrowed to workstations', () => {
    const er = coverage(facts, all, { shifts: null, workstations: new Set([1]), days: null });
    expect(er.cells.every((c) => c.workstation === 1)).toBeTrue();
    expect(er.days.reduce((n, d) => n + d.short, 0)).toBe(1);
  });
});
