import { dayNumber, isoDay, ruleWeekday, weekdayOf } from './dates';
import { NONE, decodeRosterFacts, worked } from './facts';
import { employee, rosterPayload, shift, workstation } from './testing';

describe('decodeRosterFacts', () => {
  const payload = rosterPayload(
    '2026-09-01',
    '2026-09-30',
    {
      employees: [employee('e1', 'Anna'), employee('e2', 'Ben')],
      shifts: [shift('s1', 'Early'), shift('s2', 'Night')],
      workstations: [workstation('w1', 'ICU', ['s1'])],
      months: [{ month: '2026-09-01', status: 'published' }],
      holidays: ['2026-09-16'],
    },
    [
      { date: '2026-09-12', employee: 0, shift: 0, workstation: 0, weekend: '2026-09-12' },
      { date: '2026-09-14', employee: 1, absence: 'sick' },
      { date: '2026-09-16', employee: 1, shift: 1, night: true, holiday: true, hours: 8.5 },
    ],
  );

  it('keeps every row and resolves the dimensions by index', () => {
    const facts = decodeRosterFacts(payload);
    expect(facts.size).toBe(3);
    expect(facts.employees[facts.employee[2]].name).toBe('Ben');
    expect(facts.shifts[facts.shift[2]].name).toBe('Night');
    expect(facts.workstations[facts.workstation[0]].name).toBe('ICU');
    expect(facts.workstation[2]).toBe(NONE);
  });

  it('turns dates into day numbers and codes into lists', () => {
    const facts = decodeRosterFacts(payload);
    expect(isoDay(facts.day[0])).toBe('2026-09-12');
    expect(facts.weekend[0]).toBe(dayNumber('2026-09-12'));
    expect(facts.weekend[1]).toBe(NONE);
    expect(facts.absenceTypes[facts.absence[1]]).toBe('sick');
    expect(facts.absence[0]).toBe(NONE);
    expect(facts.hours[2]).toBe(8.5);
    expect(facts.months.get('2026-09')).toBe('published');
    expect(facts.holidays.has(dayNumber('2026-09-16'))).toBeTrue();
  });

  it('counts only present entries with a shift as worked', () => {
    const facts = decodeRosterFacts(payload);
    expect([0, 1, 2].map((i) => worked(facts, i))).toEqual([true, false, true]);
  });
});

describe('day numbers', () => {
  it('round-trips and knows the weekday', () => {
    const day = dayNumber('2026-09-12');
    expect(isoDay(day)).toBe('2026-09-12');
    expect(weekdayOf(day)).toBe(5); // Saturday
    expect(weekdayOf(dayNumber('2026-09-14'))).toBe(0); // Monday
  });

  it('gives a holiday the Sunday rules', () => {
    const wednesday = dayNumber('2026-09-16');
    expect(ruleWeekday(wednesday, new Set())).toBe(2);
    expect(ruleWeekday(wednesday, new Set([wednesday]))).toBe(6);
  });
});
