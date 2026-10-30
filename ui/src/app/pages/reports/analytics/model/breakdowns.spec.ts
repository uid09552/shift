import { AuditActivityGroup, ChangeFact, PlanningRun } from '../../../../shared/services/analysis.service';
import { dayNumber } from './dates';
import { decodeRosterFacts } from './facts';
import { emptyFilters, filterItems, rosterRows } from './filter';
import {
  absences,
  audit,
  auditAccessor,
  auditLogParams,
  buckets,
  changeAccessor,
  changes,
  runOutcome,
  runs,
} from './breakdowns';
import { employee, rosterPayload } from './testing';

const SEPT = [dayNumber('2026-09-01'), dayNumber('2026-09-30')] as const;

describe('absences', () => {
  const facts = decodeRosterFacts(
    rosterPayload('2026-09-01', '2026-09-30', { employees: [employee('e1', 'Anna'), employee('e2', 'Ben')] }, [
      { date: '2026-09-07', employee: 0, absence: 'sick' }, // Monday
      { date: '2026-09-14', employee: 0, absence: 'sick' }, // Monday
      { date: '2026-09-16', employee: 1, absence: 'sick' }, // Wednesday
      { date: '2026-09-17', employee: 1, absence: 'vacation' },
      { date: '2026-09-18', employee: 1, absence: 'free' }, // a day off, not an absence
      { date: '2026-09-19', employee: 1, shift: 0 },
    ]),
  );

  it('counts sick days per weekday once the page is filtered to sick', () => {
    const rows = rosterRows(facts, { ...emptyFilters(), absence: ['sick'] }, []);
    const a = absences(facts, rows);
    expect(a.byWeekday).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(a.total).toBe(3);
  });

  it('counts types and people, leaving out plain days off', () => {
    const a = absences(facts, Array.from({ length: facts.size }, (_, i) => i));
    expect([...a.byType]).toEqual([['sick', 3], ['vacation', 1]]);
    expect(a.byEmployee.get(1)).toBe(2);
    expect(a.byTypeOverTime.get('sick')!.get('2026-09-07')).toBe(1);
  });
});

const notice = (over: Partial<ChangeFact>): ChangeFact => ({
  id: Math.random().toString(),
  created_at: '2026-09-10T08:00:00',
  date: '2026-09-12',
  employee_id: 'e1',
  employee_name: 'Anna',
  workstation_before: null,
  workstation_after: 'w1',
  workstation_before_name: null,
  workstation_after_name: 'ICU',
  shift_before: null,
  shift_after: 's1',
  absence_before: null,
  absence_after: null,
  source: 'manual',
  actor: 'planner@clinic.test',
  reason: null,
  acknowledged_at: '2026-09-10T08:30:00',
  ...over,
});

describe('roster changes', () => {
  const list = [
    notice({ source: 'replacement', reason: 'Krankmeldung Ben', acknowledged_at: null }),
    notice({ acknowledged_at: null }),
    notice({ acknowledged_at: null, employee_name: 'Ben', employee_id: 'e2' }),
    notice({ acknowledged_at: null, created_at: '2026-09-11T09:00:00' }),
    notice({ acknowledged_at: null, workstation_after: null, workstation_after_name: null, workstation_before: 'w2', workstation_before_name: 'ER' }),
    notice({ acknowledged_at: '2026-09-12T08:00:00' }), // two days later
  ];

  it('shows five unacknowledged and the share with a reason', () => {
    const c = changes(list, ...SEPT);
    expect(c.unread).toBe(5);
    expect(c.withReason).toBe(1);
    expect(c.ack.lt3d).toBe(1);
    expect(c.byWorkstation.get('ER')).toBe(1);
  });

  it('filters by source and by either workstation', () => {
    const bySource = filterItems(list, changeAccessor, { ...emptyFilters(), source: ['replacement'] }, []);
    expect(bySource.length).toBe(1);
    const byStation = filterItems(list, changeAccessor, { ...emptyFilters(), workstation: ['w2'] }, []);
    expect(byStation.length).toBe(1);
  });
});

describe('audit activity', () => {
  const groups: AuditActivityGroup[] = [
    { day: '2026-09-10', action: 'workstation.delete', entity_type: 'workstation', actor: 'anna', count: 2 },
    { day: '2026-09-10', action: 'shift.update', entity_type: 'shift', actor: 'ben', count: 5 },
    { day: '2026-09-11', action: 'workstation.delete', entity_type: 'workstation', actor: 'anna', count: 1 },
  ];

  it('totals by action, item type and actor', () => {
    const a = audit(groups, ...SEPT);
    expect(a.total).toBe(8);
    expect(a.byAction.get('workstation.delete')).toBe(3);
    expect(a.byActor.get('ben')).toBe(5);
  });

  it('builds the Audit log link for a group with exactly its filters', () => {
    expect(auditLogParams({ action: 'workstation.delete', entity_type: 'workstation', actor: 'anna' }, '2026-09-01', '2026-09-30')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      action: 'workstation.delete',
      entity_type: 'workstation',
      actor: 'anna',
    });
    expect(auditLogParams({ actor: 'anna' }, '2026-09-01', '2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30', actor: 'anna' });
  });

  it('narrows by a selected actor', () => {
    expect(filterItems(groups, auditAccessor, emptyFilters(), [{ dim: 'actor', value: 'anna' }]).length).toBe(2);
  });
});

const run = (over: Partial<PlanningRun>): PlanningRun => ({
  id: Math.random().toString(),
  created_at: '2026-09-10T02:00:00',
  finished_at: '2026-09-10T02:03:00',
  source: 'auto',
  status: 'done',
  error_message: null,
  result_id: 'r',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  solver_status: 'optimal',
  has_message: false,
  taken_as_roster: true,
  ...over,
});

describe('planning runs', () => {
  it('counts automatic runs taken and kept as a proposal', () => {
    const list = [run({}), run({}), run({ solver_status: 'feasible', has_message: true, taken_as_roster: false }), run({ source: 'manual', taken_as_roster: null })];
    const r = runs(list, ...SEPT);
    expect([r.autoTaken, r.autoKept]).toEqual([2, 1]);
    expect(r.withMessage).toBe(1);
    expect(r.durations).toEqual([3, 3, 3, 3]);
  });

  it('names the outcome of failed and pending runs', () => {
    expect(runOutcome(run({ status: 'error', solver_status: null }))).toBe('error');
    expect(runOutcome(run({ status: 'scheduled', solver_status: null }))).toBe('scheduled');
    expect(runOutcome(run({ solver_status: 'infeasible' }))).toBe('infeasible');
  });
});

describe('time buckets', () => {
  it('charts short periods per day and long ones per month', () => {
    expect(buckets(dayNumber('2026-09-01'), dayNumber('2026-09-03'))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(buckets(dayNumber('2026-01-15'), dayNumber('2026-06-30'))).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  });
});
