import { activeFilterCount, filterPeople, normalizeViewState, sameViewState } from './schedule-view-state';

describe('schedule view state', () => {
  it('makes a stored view safe to apply', () => {
    expect(normalizeViewState(null)).toEqual({ view: 'week', group: 'employee', wishesOnly: false, workstations: [], capabilities: [], employees: [] });
    const odd = normalizeViewState({ view: 'year', group: 'shift', wishesOnly: true, workstations: ['w1', 'w1', 3], employees: 'e1', extra: 1 });
    expect(odd).toEqual({ view: 'week', group: 'shift', wishesOnly: false, workstations: ['w1'], capabilities: [], employees: [] });
    // Lenses are the week's, wishes the month's, as on the page itself.
    expect(normalizeViewState({ view: 'month', group: 'shift', wishesOnly: true })).toEqual(
      jasmine.objectContaining({ view: 'month', group: 'employee', wishesOnly: true }),
    );
  });

  it('counts the filters in use and compares states regardless of order', () => {
    const a = normalizeViewState({ workstations: ['w1', 'w2'], capabilities: ['c1'] });
    expect(activeFilterCount(a)).toBe(2);
    expect(sameViewState(a, normalizeViewState({ workstations: ['w2', 'w1'], capabilities: ['c1'] }))).toBeTrue();
    expect(sameViewState(a, normalizeViewState({ workstations: ['w1'], capabilities: ['c1'] }))).toBeFalse();
  });

  it('narrows people by search, picks, capability and where they are planned', () => {
    const people = [
      { id: 'e1', name: 'Anna', capabilities: [{ id: 'icu' }] },
      { id: 'e2', name: 'Ben', capabilities: [] },
      { id: 'e3', name: 'Carla', capabilities: [{ id: 'icu' }] },
    ];
    const at: Record<string, string[]> = { e1: ['w1'], e2: ['w1'], e3: ['w2'] };
    const of = (state: object, term = '') =>
      filterPeople(people, normalizeViewState(state), term, (id) => new Set(at[id])).map((p) => p.id);
    expect(of({})).toEqual(['e1', 'e2', 'e3']);
    expect(of({}, 'an')).toEqual(['e1']);
    expect(of({ capabilities: ['icu'] })).toEqual(['e1', 'e3']);
    expect(of({ workstations: ['w1'] })).toEqual(['e1', 'e2']);
    expect(of({ workstations: ['w1'], capabilities: ['icu'] })).toEqual(['e1'], 'filters add up');
    expect(of({ employees: ['e2', 'e3'] })).toEqual(['e2', 'e3']);
  });
});
