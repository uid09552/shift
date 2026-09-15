import { AuditLog } from '../../../shared/services/audit-log.service';
import {
  carriesState,
  diffStates,
  fieldLabel,
  flatten,
  formatValue,
  idsIn,
  parseChanges,
  previousState,
  subjectName,
} from './audit-diff';

function entry(id: string, action: string, changes: unknown, over: Partial<AuditLog> = {}): AuditLog {
  return {
    id,
    actor: 'anna',
    action,
    entity_type: action.split('.')[0],
    entity_id: 'w1',
    changes: changes === null ? null : typeof changes === 'string' ? changes : JSON.stringify(changes),
    created_at: `2026-09-0${id.slice(-1)}T10:00:00`,
    ...over,
  };
}

describe('audit diff', () => {
  it('reads JSON, keeps other text as it is, and treats empty as nothing', () => {
    expect(parseChanges('{"a":1}')).toEqual({ a: 1 });
    expect(parseChanges('not json')).toBe('not json');
    expect(parseChanges(null)).toBeNull();
    expect(parseChanges('')).toBeNull();
  });

  it('flattens nested settings to dotted paths and leaves out timestamps', () => {
    const flat = flatten({
      equality_weight: 50000,
      priority_weights: { high: 10000, low: 100 },
      updated_at: '2026-09-15T07:55:27',
      active_shift_ids: ['a', 'b'],
    });
    expect(flat).toEqual({
      equality_weight: 50000,
      'priority_weights.high': 10000,
      'priority_weights.low': 100,
      active_shift_ids: ['a', 'b'],
    });
  });

  it('lists only what changed, field by field', () => {
    const before = { name: 'ICU', min_employees: 1, priority_weights: { high: 10000 }, updated_at: 'x' };
    const after = { name: 'ICU', min_employees: 2, priority_weights: { high: 20000 }, updated_at: 'y' };
    expect(diffStates(before, after)).toEqual([
      { path: 'min_employees', kind: 'changed', before: 1, after: 2 },
      { path: 'priority_weights.high', kind: 'changed', before: 10000, after: 20000 },
    ]);
  });

  it('reports fields that appear or disappear, and a value cleared to null', () => {
    const changes = diffStates({ a: 1, b: 2 }, { a: null, c: 3 });
    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['a', 'changed'],
      ['b', 'removed'],
      ['c', 'added'],
    ]);
  });

  it('ignores the order of a list and says which entries came and went', () => {
    expect(diffStates({ ids: ['a', 'b'] }, { ids: ['b', 'a'] })).toEqual([]);
    const [change] = diffStates({ ids: ['a', 'b'] }, { ids: ['b', 'c'] });
    expect(change.itemsAdded).toEqual(['c']);
    expect(change.itemsRemoved).toEqual(['a']);
  });

  it('compares an update with the next older entry that carries a state', () => {
    const history = [
      entry('e4', 'workstation.update', { name: 'ICU 2' }),
      entry('e3', 'workstation.update', { name: 'ICU' }),
      entry('e2', 'workstation.delete', null),
      entry('e1', 'workstation.create', { name: 'Old' }),
    ];
    expect(previousState(history[0], history)?.id).toBe('e3');
    // A delete in between is skipped: it holds a name, not the state.
    expect(previousState(history[1], history)?.id).toBe('e1');
    expect(previousState(history[3], history)).toBeNull();
  });

  it('falls back to the timeline when the entry is not in the fetched history', () => {
    const history = [entry('e1', 'workstation.create', { name: 'ICU' })];
    const later = entry('e5', 'workstation.update', { name: 'ICU 2' });
    expect(previousState(later, history)?.id).toBe('e1');
  });

  it('knows which entries hold one item’s state', () => {
    expect(carriesState(entry('e1', 'workstation.update', {}))).toBeTrue();
    expect(carriesState(entry('e1', 'user.update_roles', {}))).toBeTrue();
    expect(carriesState(entry('e1', 'workstation.delete', {}))).toBeFalse();
    expect(carriesState(entry('e1', 'employee.import', {}, { entity_id: null }))).toBeFalse();
    expect(carriesState(entry('e1', 'planner.optimize', {}))).toBeFalse();
  });

  it('names the subject from name, a person’s name, username or email', () => {
    expect(subjectName(entry('e1', 'workstation.delete', { name: 'ICU' }))).toBe('ICU');
    expect(subjectName(entry('e1', 'user.create', { first_name: 'Anna', last_name: 'Müller', username: 'am' }))).toBe('Anna Müller');
    expect(subjectName(entry('e1', 'user.create', { username: 'am', email: 'a@x' }))).toBe('am');
    expect(subjectName(entry('e1', 'workstation.delete', null))).toBeNull();
    expect(subjectName(entry('e1', 'x.y', 'free text'))).toBeNull();
  });

  it('turns keys into labels', () => {
    expect(fieldLabel('min_employees')).toBe('Min employees');
    expect(fieldLabel('priority_weights.high')).toBe('Priority weights › high');
    expect(fieldLabel('active_shift_ids')).toBe('Active shifts');
    expect(fieldLabel('shift_id')).toBe('Shift');
  });

  it('shows values as people read them, ids resolved where known', () => {
    const names = new Map([['fb34f47f-a681-47c0-a2f6-787408bd37c3', 'Früh']]);
    expect(formatValue(null)).toBe('—');
    expect(formatValue([])).toBe('—');
    expect(formatValue(['fb34f47f-a681-47c0-a2f6-787408bd37c3', '908fd693-bdbe-4946-928d-e58ad22d28b3'], names)).toBe('Früh, 908fd693');
    expect(formatValue(11.5)).toBe('11.5');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });

  it('finds the ids among values, inside lists too', () => {
    const id = 'FB34F47F-A681-47C0-A2F6-787408BD37C3';
    expect(idsIn([id, ['908fd693-bdbe-4946-928d-e58ad22d28b3', 'x'], 3, null])).toEqual([
      id.toLowerCase(),
      '908fd693-bdbe-4946-928d-e58ad22d28b3',
    ]);
  });
});
