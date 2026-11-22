import { fold, isoDay, matchScore, parseDateQuery } from './palette-search';
import { paletteItems, searchPalette } from './command-palette.component';

describe('palette search', () => {
  // A Wednesday.
  const today = new Date(2026, 10, 18);

  it('folds case and accents', () => {
    expect(fold('Müller ÉCOLE')).toBe('muller ecole');
    expect(matchScore('Jörg Müller', 'muller')).toBeGreaterThan(0);
  });

  it('ranks a prefix over a word start over a substring, and needs every word', () => {
    const prefix = matchScore('Night shift', 'nig');
    const word = matchScore('Late night', 'nig');
    const inside = matchScore('Overnight', 'nig');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(matchScore('Anna Berg', 'anna x')).toBe(0);
  });

  it('reads dates in ISO, German and US forms, and only real ones', () => {
    expect(isoDay(parseDateQuery('2026-12-24', today)!)).toBe('2026-12-24');
    expect(isoDay(parseDateQuery('24.12.2026', today)!)).toBe('2026-12-24');
    expect(isoDay(parseDateQuery('24.12.', today)!)).toBe('2026-12-24');
    expect(isoDay(parseDateQuery('12/24/2026', today)!)).toBe('2026-12-24');
    expect(parseDateQuery('2026-02-30', today)).toBeNull();
    expect(parseDateQuery('ICU', today)).toBeNull();
  });

  it('reads relative days and weekdays in English and German', () => {
    expect(isoDay(parseDateQuery('today', today)!)).toBe('2026-11-18');
    expect(isoDay(parseDateQuery('morgen', today)!)).toBe('2026-11-19');
    expect(isoDay(parseDateQuery('gestern', today)!)).toBe('2026-11-17');
    expect(isoDay(parseDateQuery('friday', today)!)).toBe('2026-11-20');
    expect(isoDay(parseDateQuery('Wednesday', today)!)).toBe('2026-11-18', 'the coming one, today included');
    expect(isoDay(parseDateQuery('next wednesday', today)!)).toBe('2026-11-25', 'never today');
    expect(isoDay(parseDateQuery('next Monday', today)!)).toBe('2026-11-23');
    expect(isoDay(parseDateQuery('nächsten Montag', today)!)).toBe('2026-11-23');
  });
});

describe('palette items', () => {
  const today = new Date(2026, 10, 18);
  const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  const data = {
    employees: [{ id: 'e1', name: 'Anna Berg', email: 'anna@clinic.test' }],
    workstations: [{ id: 'w1', name: 'ICU' }],
    shifts: [{ id: 's1', name: 'Night' }],
    capabilities: [{ id: 'c1', name: 'Intensive care' }],
  };
  const ids = (items: { id: string }[]) => items.map((i) => i.id);

  it("follows the user's role: planners get planning actions and admin pages stay with admins", () => {
    const viewer = paletteItems(t, { canPlan: false, isAdmin: false }, data, today, 'en');
    expect(ids(viewer)).toContain('action:leave');
    expect(ids(viewer)).not.toContain('action:calculate');
    expect(ids(viewer)).not.toContain('replacement:e1');
    expect(ids(viewer)).not.toContain('page:/users');
    expect(ids(viewer)).not.toContain('page:/analytics');
    expect(viewer.find((i) => i.id === 'workstation:w1')!.url).toBe('/workstations', 'a viewer cannot edit');

    const planner = paletteItems(t, { canPlan: true, isAdmin: false }, data, today, 'en');
    expect(ids(planner)).toContain('action:calculate');
    expect(ids(planner)).toContain('replacement:e1');
    expect(ids(planner)).toContain('page:/analytics');
    expect(ids(planner)).not.toContain('page:/users');
    expect(planner.find((i) => i.id === 'workstation:w1')!.url).toBe('/workstations/w1/edit');

    const admin = paletteItems(t, { canPlan: true, isAdmin: true }, data, today, 'en');
    expect(ids(admin)).toContain('page:/users');
    expect(ids(admin)).toContain('action:setup');
  });

  it('offers actions and pages before anything is typed, data once something is', () => {
    const items = paletteItems(t, { canPlan: true, isAdmin: false }, data, today, 'en');
    const empty = searchPalette(items, '', today, () => 'day');
    expect(empty.some((i) => i.kind === 'employee')).toBeFalse();
    expect(empty[0].kind).toBe('action');

    const anna = searchPalette(items, 'anna', today, () => 'day');
    expect(ids(anna)).toEqual(jasmine.arrayContaining(['employee:e1', 'replacement:e1']));
    expect(anna.find((i) => i.id === 'employee:e1')!.queryParams).toEqual({ employeeId: 'e1' });
    expect(anna.find((i) => i.id === 'replacement:e1')!.queryParams).toEqual({ replace: 'e1', on: '2026-11-18' });

    expect(ids(searchPalette(items, 'icu', today, () => 'day'))[0]).toBe('workstation:w1');
    expect(ids(searchPalette(items, 'publish', today, () => 'day'))).toContain('action:publish:0');
  });

  it('puts a named day first, opening the Schedule page on it', () => {
    const items = paletteItems(t, { canPlan: false, isAdmin: false }, data, today, 'en');
    const [first] = searchPalette(items, '2026-12-24', today, (d) => `Open ${isoDay(d)}`);
    expect(first).toEqual(jasmine.objectContaining({ kind: 'date', label: 'Open 2026-12-24', url: '/kalender', queryParams: { date: '2026-12-24' } }));
  });
});
