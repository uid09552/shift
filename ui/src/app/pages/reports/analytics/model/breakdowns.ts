import { AuditActivityGroup, ChangeFact, PlanningRun } from '../../../../shared/services/analysis.service';
import { dayNumber, isoDay, monthOf, weekdayOf } from './dates';
import { NONE, RosterFacts } from './facts';

/** Periods up to this many days are charted per day, longer ones per month. */
export const DAILY_UP_TO = 92;

/** The time bucket of a day: the day itself in a short period, else its month. */
export function bucketOf(day: number, from: number, to: number): string {
  return to - from + 1 <= DAILY_UP_TO ? isoDay(day) : monthOf(day);
}

/** Every bucket of the period, in order — so empty days and months still show. */
export function buckets(from: number, to: number): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d++) {
    const b = bucketOf(d, from, to);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out;
}

/** Counts per key, most first, ties by name. */
export function ranked(counts: Map<string, number>, limit = Infinity): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

// ---- Absences --------------------------------------------------------------

/**
 * `free` is the plan's own "not working" — not an absence, and the Fairness
 * report leaves it out too. A recorded `day_off` is an absence and counts.
 */
export const DAY_OFF = 'free';

export interface Absences {
  total: number;
  /** type → bucket → days */
  byTypeOverTime: Map<string, Map<string, number>>;
  byType: Map<string, number>;
  byEmployee: Map<number, number>;
  /** 0 = Monday … 6 = Sunday */
  byWeekday: number[];
}

export function absences(facts: RosterFacts, rows: readonly number[]): Absences {
  const result: Absences = { total: 0, byTypeOverTime: new Map(), byType: new Map(), byEmployee: new Map(), byWeekday: [0, 0, 0, 0, 0, 0, 0] };
  for (const i of rows) {
    if (facts.absence[i] === NONE) continue;
    const type = facts.absenceTypes[facts.absence[i]];
    if (type === DAY_OFF) continue;
    result.total++;
    bump(result.byType, type);
    bump(result.byEmployee, facts.employee[i]);
    result.byWeekday[weekdayOf(facts.day[i])]++;
    if (!result.byTypeOverTime.has(type)) result.byTypeOverTime.set(type, new Map());
    bump(result.byTypeOverTime.get(type)!, bucketOf(facts.day[i], facts.from, facts.to));
  }
  return result;
}

// ---- Roster changes --------------------------------------------------------

export function changeAccessor(n: ChangeFact, dim: string): string | readonly string[] | null | undefined {
  switch (dim) {
    case 'employee':
      return n.employee_id;
    case 'workstation': {
      const both = [n.workstation_before, n.workstation_after].filter((w): w is string => !!w);
      return both.length ? both : null;
    }
    case 'shift': {
      const both = [n.shift_before, n.shift_after].filter((s): s is string => !!s);
      return both.length ? both : null;
    }
    case 'source':
      return n.source;
    case 'actor':
      return n.actor;
    case 'day':
      return n.created_at.slice(0, 10);
    case 'month':
      return n.created_at.slice(0, 7);
    default:
      return undefined;
  }
}

/** How long until a notice was read, in buckets a planner talks in. */
export const ACK_BUCKETS = ['lt1h', 'lt1d', 'lt3d', 'lt7d', 'gte7d', 'unread'] as const;
export type AckBucket = (typeof ACK_BUCKETS)[number];

export function ackBucket(n: ChangeFact): AckBucket {
  if (!n.acknowledged_at) return 'unread';
  const hours = (Date.parse(n.acknowledged_at + 'Z') - Date.parse(n.created_at + 'Z')) / 3_600_000;
  if (hours < 1) return 'lt1h';
  if (hours < 24) return 'lt1d';
  if (hours < 72) return 'lt3d';
  if (hours < 168) return 'lt7d';
  return 'gte7d';
}

export interface Changes {
  total: number;
  withReason: number;
  unread: number;
  /** source → bucket → notices */
  bySourceOverTime: Map<string, Map<string, number>>;
  byEmployee: Map<string, number>;
  byWorkstation: Map<string, number>;
  byActor: Map<string, number>;
  ack: Record<AckBucket, number>;
}

export function changes(notices: readonly ChangeFact[], from: number, to: number): Changes {
  const result: Changes = {
    total: notices.length,
    withReason: 0,
    unread: 0,
    bySourceOverTime: new Map(),
    byEmployee: new Map(),
    byWorkstation: new Map(),
    byActor: new Map(),
    ack: { lt1h: 0, lt1d: 0, lt3d: 0, lt7d: 0, gte7d: 0, unread: 0 },
  };
  for (const n of notices) {
    if (n.reason && n.reason.trim()) result.withReason++;
    const ack = ackBucket(n);
    result.ack[ack]++;
    if (ack === 'unread') result.unread++;
    if (!result.bySourceOverTime.has(n.source)) result.bySourceOverTime.set(n.source, new Map());
    bump(result.bySourceOverTime.get(n.source)!, bucketOf(dayNumber(n.created_at.slice(0, 10)), from, to));
    bump(result.byEmployee, n.employee_name);
    const station = n.workstation_after_name ?? n.workstation_before_name;
    if (station) bump(result.byWorkstation, station);
    bump(result.byActor, n.actor ?? '—');
  }
  return result;
}

// ---- Audit activity --------------------------------------------------------

export function auditAccessor(g: AuditActivityGroup, dim: string): string | null | undefined {
  switch (dim) {
    case 'action':
      return g.action;
    case 'entity':
      return g.entity_type;
    case 'actor':
      return g.actor;
    case 'day':
      return g.day;
    case 'month':
      return g.day.slice(0, 7);
    default:
      return undefined;
  }
}

export interface Audit {
  total: number;
  /** action → bucket → entries */
  byActionOverTime: Map<string, Map<string, number>>;
  byAction: Map<string, number>;
  byEntity: Map<string, number>;
  byActor: Map<string, number>;
}

export function audit(groups: readonly AuditActivityGroup[], from: number, to: number): Audit {
  const result: Audit = { total: 0, byActionOverTime: new Map(), byAction: new Map(), byEntity: new Map(), byActor: new Map() };
  for (const g of groups) {
    result.total += g.count;
    bump(result.byAction, g.action, g.count);
    bump(result.byEntity, g.entity_type ?? '—', g.count);
    bump(result.byActor, g.actor ?? '—', g.count);
    if (!result.byActionOverTime.has(g.action)) result.byActionOverTime.set(g.action, new Map());
    bump(result.byActionOverTime.get(g.action)!, bucketOf(dayNumber(g.day), from, to), g.count);
  }
  return result;
}

/**
 * The Audit log page's filters for one group — it reads `from`, `to`,
 * `action`, `entity_type` and `actor` from its address. Days are inclusive.
 */
export function auditLogParams(
  group: { action?: string | null; entity_type?: string | null; actor?: string | null },
  from: string,
  to: string,
): Record<string, string> {
  const params: Record<string, string> = { from, to };
  if (group.action) params['action'] = group.action;
  if (group.entity_type) params['entity_type'] = group.entity_type;
  if (group.actor) params['actor'] = group.actor;
  return params;
}

// ---- Planning runs ---------------------------------------------------------

/** One word for how a run ended: its solver verdict, or the task's own state. */
export function runOutcome(r: PlanningRun): string {
  if (r.status === 'error') return 'error';
  if (r.status === 'scheduled') return 'scheduled';
  return r.solver_status ?? 'unknown';
}

export function runAccessor(r: PlanningRun, dim: string): string | null | undefined {
  switch (dim) {
    case 'runSource':
      return r.source;
    case 'runStatus':
      return runOutcome(r);
    case 'day':
      return r.created_at.slice(0, 10);
    case 'month':
      return r.created_at.slice(0, 7);
    default:
      return undefined;
  }
}

/** Minutes from start to finish; null while it runs. */
export function runMinutes(r: PlanningRun): number | null {
  if (!r.finished_at) return null;
  return Math.round(((Date.parse(r.finished_at + 'Z') - Date.parse(r.created_at + 'Z')) / 60_000) * 10) / 10;
}

export interface Runs {
  total: number;
  /** source → bucket → runs */
  bySourceOverTime: Map<string, Map<string, number>>;
  byOutcome: Map<string, number>;
  /** Automatic runs whose plan became the roster, and those kept as a proposal. */
  autoTaken: number;
  autoKept: number;
  withMessage: number;
  durations: number[];
}

export function runs(list: readonly PlanningRun[], from: number, to: number): Runs {
  const result: Runs = { total: list.length, bySourceOverTime: new Map(), byOutcome: new Map(), autoTaken: 0, autoKept: 0, withMessage: 0, durations: [] };
  for (const r of list) {
    bump(result.byOutcome, runOutcome(r));
    if (!result.bySourceOverTime.has(r.source)) result.bySourceOverTime.set(r.source, new Map());
    bump(result.bySourceOverTime.get(r.source)!, bucketOf(dayNumber(r.created_at.slice(0, 10)), from, to));
    if (r.source === 'auto' && r.taken_as_roster === true) result.autoTaken++;
    if (r.source === 'auto' && r.taken_as_roster === false) result.autoKept++;
    if (r.has_message) result.withMessage++;
    const minutes = runMinutes(r);
    if (minutes !== null) result.durations.push(minutes);
  }
  return result;
}
