import { AuditLog } from '../../../shared/services/audit-log.service';

/**
 * What an audit entry's `changes` means, and what changed against the entry
 * before it.
 *
 * The backend stores the *new state* of a thing on create and update (the
 * request body, or the saved settings), a summary for runs and imports, and
 * `{"name": …}` on delete. So "what changed" is never stored — it is the
 * difference between this entry's state and the previous entry's for the same
 * item, worked out here.
 */

/** Keys that change on every save and say nothing about what was changed. */
const NOISE_KEYS = new Set(['updated_at', 'created_at', 'tenant_id']);

export interface FieldChange {
  /** Dotted path for nested settings, e.g. `priority_weights.high`. */
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
  /** For lists of plain values: which entries came and went. */
  itemsAdded?: unknown[];
  itemsRemoved?: unknown[];
}

/** The parsed `changes`, or the raw text when it is not JSON; null when empty. */
export function parseChanges(changes: string | null | undefined): unknown {
  if (changes == null || changes === '') return null;
  try {
    return JSON.parse(changes);
  } catch {
    return changes;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Nested objects become dotted keys so settings like `priority_weights.high`
 * diff field by field; lists stay whole. Noise keys are left out.
 */
export function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (NOISE_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(inner) && Object.keys(inner).length > 0) {
      Object.assign(out, flatten(inner, path));
    } else {
      out[path] = inner;
    }
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b) && a.every(isPrimitive) && b.every(isPrimitive)) {
    // Order of ids in a list is not a change anyone made.
    return a.length === b.length && [...a].map(String).sort().join('\u0000') === [...b].map(String).sort().join('\u0000');
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * Field-by-field difference between two states. A field missing on one side is
 * added or removed; `null` counts as a value, so "limit cleared" shows up as a
 * change to empty rather than disappearing.
 */
export function diffStates(before: unknown, after: unknown): FieldChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const changes: FieldChange[] = [];
  for (const path of paths) {
    const inA = path in a;
    const inB = path in b;
    if (inA && inB && same(a[path], b[path])) continue;
    const change: FieldChange = {
      path,
      kind: !inA ? 'added' : !inB ? 'removed' : 'changed',
      before: a[path],
      after: b[path],
    };
    const was = a[path];
    const now = b[path];
    if (Array.isArray(was) && Array.isArray(now) && was.every(isPrimitive) && now.every(isPrimitive)) {
      const wasSet = new Set(was.map(String));
      const nowSet = new Set(now.map(String));
      change.itemsAdded = now.filter((v) => !wasSet.has(String(v)));
      change.itemsRemoved = was.filter((v) => !nowSet.has(String(v)));
    }
    changes.push(change);
  }
  return changes;
}

/**
 * The entry an update should be compared with: the next older one about the
 * same item that carries a state. `history` is that item's entries, newest
 * first, as `GET /audit-logs?entity_type&entity_id` returns them.
 */
export function previousState(entry: AuditLog, history: AuditLog[]): AuditLog | null {
  const at = history.findIndex((h) => h.id === entry.id);
  const older = at >= 0 ? history.slice(at + 1) : history.filter((h) => h.created_at < entry.created_at);
  return older.find((h) => !isDelete(h.action) && isPlainObject(parseChanges(h.changes))) ?? null;
}

export function isDelete(action: string): boolean {
  return action.endsWith('.delete') || action.endsWith('.remove_from_organization');
}

export function isCreate(action: string): boolean {
  return action.endsWith('.create') || action.endsWith('.add_to_organization');
}

/**
 * Entries whose `changes` is the state of one item, and so can be compared
 * with the item's previous entry. Runs, imports and bulk writes carry a
 * summary instead.
 */
export function carriesState(entry: AuditLog): boolean {
  if (!entry.entity_id || isDelete(entry.action)) return false;
  return /\.(create|update|update_roles|add_to_organization)$/.test(entry.action);
}

/** What the entry is about, by name, when its `changes` says so. */
export function subjectName(entry: AuditLog): string | null {
  const parsed = parseChanges(entry.changes);
  if (!isPlainObject(parsed)) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const person = [text(parsed['first_name']), text(parsed['last_name'])].filter(Boolean).join(' ');
  return text(parsed['name']) ?? (person || null) ?? text(parsed['username']) ?? text(parsed['email']);
}

/**
 * "min_employees" → "Min employees", "priority_weights.high" → "Priority
 * weights › high", "active_shift_ids" → "Active shifts" — ids are shown as
 * names, so the label should not promise ids.
 */
export function fieldLabel(path: string): string {
  const label = path
    .split('.')
    .map((part) => part.replace(/_ids$/, 's').replace(/_id$/, '').replace(/_/g, ' '))
    .join(' › ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** `planner_settings.update` → "Planner settings update" — for actions without a translation. */
export function humanizeAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids among these values, lists included — lower-cased, as `names` keys them. */
export function idsIn(values: unknown[]): string[] {
  const ids = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (typeof v === 'string' && UUID.test(v)) ids.add(v.toLowerCase());
  };
  values.forEach(visit);
  return [...ids];
}

/**
 * A value as a person reads it: ids resolved to names where `names` knows
 * them, lists joined, empty shown as a dash.
 */
export function formatValue(value: unknown, names: ReadonlyMap<string, string> = new Map()): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((v) => formatValue(v, names)).join(', ');
  }
  if (typeof value === 'string') {
    return UUID.test(value) ? (names.get(value.toLowerCase()) ?? value.slice(0, 8)) : value;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
