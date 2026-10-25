import {
  AUTO_PLAN_RANGES,
  USE_CASE_TEMPLATES,
  differingSettings,
  exactUseCase,
  nextOccurrence,
  rangeValue,
  resolveUseCase,
  type PresetValues,
} from './planner-settings.presets';

describe('use case selection', () => {
  const template = (id: string) => USE_CASE_TEMPLATES.find((t) => t.id === id)!;
  /** A form holding exactly a template's values, copied so a test can change it. */
  const formOf = (id: string): PresetValues => ({
    ...template(id).values,
    priority_weights: { ...template(id).values.priority_weights },
  });

  it('counts nothing for a form that holds a template exactly', () => {
    expect(differingSettings(template('fairness').values, formOf('fairness'))).toBe(0);
  });

  it('counts each changed setting once, and the priority weights as one setting', () => {
    const form = formOf('fairness');
    form.wish_weight = 1;
    expect(differingSettings(template('fairness').values, form)).toBe(1);
    form.fatigue_weight = 2;
    form.priority_weights.high = 5;
    form.priority_weights.low = 6;
    expect(differingSettings(template('fairness').values, form)).toBe(3);
  });

  it('knows a form that holds a template exactly, and none that holds a mix', () => {
    expect(exactUseCase(formOf('wellbeing'))?.id).toBe('wellbeing');
    const mixed = formOf('wellbeing');
    mixed.equality_weight = 1;
    expect(exactUseCase(mixed)).toBeNull();
  });

  it('keeps a stored use case selected however far the values have moved', () => {
    const form = formOf('wishes');
    form.wish_weight = 5000; // now equal to nothing in particular...
    form.equality_weight = 120000;
    form.fatigue_weight = 800;
    // ...and closer to another template than to the stored one, which still wins
    const selected = resolveUseCase('wishes', form);
    expect(selected.template?.id).toBe('wishes');
    expect(selected.changed).toBe(3);
  });

  it('reports no change for a stored use case whose values are untouched', () => {
    expect(resolveUseCase('coverage', formOf('coverage'))).toEqual({ template: template('coverage'), changed: 0 });
  });

  it('shows a stored id it does not know as custom, even when the values match a template', () => {
    expect(resolveUseCase('removed-in-a-later-release', formOf('balanced'))).toEqual({ template: null, changed: 0 });
  });

  it('derives an exact match when nothing is stored, and custom when none matches', () => {
    expect(resolveUseCase(null, formOf('stability'))).toEqual({ template: template('stability'), changed: 0 });
    const mixed = formOf('stability');
    mixed.min_rest_hours = 9;
    expect(resolveUseCase(null, mixed)).toEqual({ template: null, changed: 0 });
  });

  it('ignores what a use case never sets', () => {
    const form = { ...formOf('balanced'), solver_num_workers: 99 } as unknown as PresetValues;
    expect(exactUseCase(form)?.id).toBe('balanced');
  });
});

describe('automatic planning helpers', () => {
  it('offers exactly the eight ranges, weeks before months', () => {
    expect(AUTO_PLAN_RANGES.map((r) => r.value)).toEqual([
      'weeks:2', 'weeks:4', 'weeks:6', 'weeks:8', 'weeks:12', 'months:1', 'months:2', 'months:3',
    ]);
    for (const r of AUTO_PLAN_RANGES) expect(rangeValue(r.unit, r.count)).toBe(r.value);
  });

  it('finds the next chosen weekday on or after a day', () => {
    const wednesday = new Date(2026, 9, 28); // 2026-10-28
    expect(nextOccurrence(2, wednesday)).toBe('2026-10-28'); // today counts
    expect(nextOccurrence(3, wednesday)).toBe('2026-10-29');
    expect(nextOccurrence(0, wednesday)).toBe('2026-11-02'); // next Monday, over a month end
    expect(nextOccurrence(1, wednesday)).toBe('2026-11-03');
  });

  it('handles Sunday, whose JavaScript weekday is 0', () => {
    const sunday = new Date(2026, 10, 1); // 2026-11-01
    expect(nextOccurrence(6, sunday)).toBe('2026-11-01');
    expect(nextOccurrence(0, sunday)).toBe('2026-11-02');
  });

  it('crosses a year end', () => {
    expect(nextOccurrence(4, new Date(2026, 11, 30))).toBe('2027-01-01');
  });
});
