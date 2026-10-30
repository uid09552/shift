import { isoDay } from './dates';
import { decodeRosterFacts } from './facts';
import { emptyFilters, rosterRows } from './filter';
import { employee, rosterPayload, shift, workstation } from './testing';

describe('roster filters and selections', () => {
  const facts = decodeRosterFacts(
    rosterPayload(
      '2026-09-01',
      '2026-09-30',
      {
        employees: [employee('e1', 'Anna', ['icu-cert']), employee('e2', 'Ben'), employee('e3', 'Carla', ['icu-cert'])],
        shifts: [shift('s1', 'Early')],
        workstations: [workstation('w1', 'ICU', ['s1']), workstation('w2', 'ER', ['s1'])],
      },
      [
        { date: '2026-09-14', employee: 0, shift: 0, workstation: 0 },
        { date: '2026-09-14', employee: 1, shift: 0, workstation: 1 },
        { date: '2026-09-15', employee: 2, shift: 0, workstation: 0 },
        { date: '2026-09-15', employee: 1, absence: 'sick' },
      ],
    ),
  );

  it('passes everything without filters', () => {
    expect(rosterRows(facts, emptyFilters(), [])).toEqual([0, 1, 2, 3]);
  });

  it('keeps only holders of a filtered capability', () => {
    const filters = { ...emptyFilters(), capability: ['icu-cert'] };
    const names = rosterRows(facts, filters, []).map((i) => facts.employees[facts.employee[i]].name);
    expect(names).toEqual(['Anna', 'Carla']);
  });

  it('treats several values on one dimension as alternatives and dimensions as AND', () => {
    const filters = { ...emptyFilters(), workstation: ['w1', 'w2'], employee: ['e2'] };
    expect(rosterRows(facts, filters, [])).toEqual([1]);
  });

  it('drops rows without a value on a filtered dimension', () => {
    const filters = { ...emptyFilters(), workstation: ['w2'] };
    expect(rosterRows(facts, filters, [])).toEqual([1]); // the sick row has no workstation
  });

  it('narrows other charts by a day selection but not the day chart itself', () => {
    const selections = [{ dim: 'day' as const, value: '2026-09-14' }];
    const others = rosterRows(facts, emptyFilters(), selections);
    expect(others.map((i) => isoDay(facts.day[i]))).toEqual(['2026-09-14', '2026-09-14']);

    const dayChart = rosterRows(facts, emptyFilters(), selections, 'day');
    expect(dayChart.length).toBe(4);
  });

  it('ignores dimensions that do not apply to roster rows', () => {
    const filters = { ...emptyFilters(), source: ['replacement'] };
    expect(rosterRows(facts, filters, [{ dim: 'actor', value: 'anna' }]).length).toBe(4);
  });
});
