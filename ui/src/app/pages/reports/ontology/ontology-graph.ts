/**
 * The Ontology report's model: who has which capability, who may work
 * which shift, what each workstation requires and runs, and — for a chosen
 * period — who is rostered where. Pure functions over API data, so the
 * rules are tested without a browser; the page only draws the result.
 */

export type NodeType = 'employee' | 'capability' | 'workstation' | 'shift';

/** `assigned` is a confirmed roster entry; the other four are configuration. */
export type LinkType = 'hasCapability' | 'mayWork' | 'requires' | 'runs' | 'assigned';

export const NODE_TYPES: NodeType[] = ['employee', 'capability', 'workstation', 'shift'];
export const LINK_TYPES: LinkType[] = ['hasCapability', 'mayWork', 'requires', 'runs', 'assigned'];

export interface GraphNode {
  /** `emp:` / `cap:` / `ws:` / `shift:` + the entity's id — unique across types. */
  id: string;
  type: NodeType;
  entityId: string;
  name: string;
  /** Shift colour, as on the Schedule page. */
  color?: string;
  /** A workstation set unavailable. */
  closed?: boolean;
  /** A capability an open workstation requires that fewer than two people hold. */
  spof?: boolean;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  /** Assignment links: days of the period the pair is rostered together. */
  days?: number;
  /** Assignment to a workstation that requires a capability the employee lacks. */
  uncovered?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphInput {
  employees: { id: string; name: string; capabilities: { id: string }[]; available_shifts: { id: string }[] }[];
  capabilities: { id: string; name: string }[];
  workstations: { id: string; name: string; available: boolean; active_shift_ids: string[] }[];
  /** Required capability ids per workstation id. */
  requiredCapabilities: Record<string, string[]>;
  shifts: { id: string; name: string; color?: string }[];
}

/** A confirmed roster entry, as `/confirmed-shift-plans` returns it. */
export interface RosterEntry {
  employee_id: string;
  shift_id: string | null;
  workstation_id: string | null;
  date: string;
  is_present: boolean;
  absence_type: string | null;
}

const nodeId = {
  employee: (id: string) => `emp:${id}`,
  capability: (id: string) => `cap:${id}`,
  workstation: (id: string) => `ws:${id}`,
  shift: (id: string) => `shift:${id}`,
};

/**
 * The network for `input`; with `roster`, also an assignment link per
 * employee–workstation and employee–shift pair, counting the distinct days
 * the pair occurs. Absences and days off are not assignments. A reference to
 * an item that no longer exists draws no link.
 */
export function buildGraph(input: GraphInput, roster?: RosterEntry[] | null): Graph {
  const nodes: GraphNode[] = [
    ...input.employees.map((e) => ({ id: nodeId.employee(e.id), type: 'employee' as const, entityId: e.id, name: e.name })),
    ...input.capabilities.map((c) => ({ id: nodeId.capability(c.id), type: 'capability' as const, entityId: c.id, name: c.name })),
    ...input.workstations.map((w) => ({
      id: nodeId.workstation(w.id),
      type: 'workstation' as const,
      entityId: w.id,
      name: w.name,
      closed: !w.available,
    })),
    ...input.shifts.map((s) => ({ id: nodeId.shift(s.id), type: 'shift' as const, entityId: s.id, name: s.name, color: s.color })),
  ];
  const known = new Set(nodes.map((n) => n.id));
  const links: GraphLink[] = [];
  const add = (source: string, target: string, type: LinkType, extra: Partial<GraphLink> = {}) => {
    if (known.has(source) && known.has(target)) {
      links.push({ id: `${type}:${source}>${target}`, source, target, type, ...extra });
    }
  };

  const capabilitiesOf = new Map<string, Set<string>>();
  for (const e of input.employees) {
    capabilitiesOf.set(e.id, new Set(e.capabilities.map((c) => c.id)));
    for (const c of e.capabilities) add(nodeId.employee(e.id), nodeId.capability(c.id), 'hasCapability');
    for (const s of e.available_shifts) add(nodeId.employee(e.id), nodeId.shift(s.id), 'mayWork');
  }
  for (const w of input.workstations) {
    for (const c of input.requiredCapabilities[w.id] ?? []) add(nodeId.workstation(w.id), nodeId.capability(c), 'requires');
    for (const s of w.active_shift_ids) add(nodeId.workstation(w.id), nodeId.shift(s), 'runs');
  }

  // Single points of failure: required by an open workstation, held by < 2.
  const holders = new Map<string, number>();
  for (const caps of capabilitiesOf.values()) for (const c of caps) holders.set(c, (holders.get(c) ?? 0) + 1);
  const requiredOpen = new Set(
    input.workstations.filter((w) => w.available).flatMap((w) => input.requiredCapabilities[w.id] ?? []),
  );
  for (const n of nodes) {
    if (n.type === 'capability' && requiredOpen.has(n.entityId) && (holders.get(n.entityId) ?? 0) < 2) n.spof = true;
  }

  if (roster) {
    const days = new Map<string, Set<string>>();
    const count = (source: string, target: string, date: string) => {
      const key = `${source}|${target}`;
      if (!days.has(key)) days.set(key, new Set());
      days.get(key)!.add(date);
    };
    for (const r of roster) {
      if (!r.is_present || r.absence_type || !r.shift_id) continue;
      const emp = nodeId.employee(r.employee_id);
      if (r.workstation_id) count(emp, nodeId.workstation(r.workstation_id), r.date);
      count(emp, nodeId.shift(r.shift_id), r.date);
    }
    for (const [key, dates] of days) {
      const [source, target] = key.split('|');
      let uncovered = false;
      if (target.startsWith('ws:')) {
        const have = capabilitiesOf.get(source.slice(4)) ?? new Set<string>();
        uncovered = (input.requiredCapabilities[target.slice(3)] ?? []).some((c) => !have.has(c));
      }
      add(source, target, 'assigned', { days: dates.size, uncovered });
    }
  }

  return { nodes, links };
}

export interface GraphFilters {
  nodeTypes: ReadonlySet<NodeType>;
  linkTypes: ReadonlySet<LinkType>;
  /** Case-insensitive part of a name; empty = no search. */
  search: string;
}

export interface FilteredGraph extends Graph {
  /** Matches of the search and their direct neighbours; null without a search. */
  highlighted: Set<string> | null;
}

/** What is visible under `filters`: a hidden node type takes its links with it. */
export function applyFilters(graph: Graph, filters: GraphFilters): FilteredGraph {
  const nodes = graph.nodes.filter((n) => filters.nodeTypes.has(n.type));
  const visible = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter(
    (l) => filters.linkTypes.has(l.type) && visible.has(endId(l.source)) && visible.has(endId(l.target)),
  );
  const term = filters.search.trim().toLowerCase();
  if (!term) return { nodes, links, highlighted: null };
  const matches = nodes.filter((n) => n.name.toLowerCase().includes(term)).map((n) => n.id);
  const highlighted = new Set<string>();
  for (const id of matches) for (const n of neighbourhood(links, id)) highlighted.add(n);
  return { nodes, links, highlighted };
}

/** `id` and every node one link away from it. */
export function neighbourhood(links: GraphLink[], id: string): Set<string> {
  const result = new Set([id]);
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (s === id) result.add(t);
    else if (t === id) result.add(s);
  }
  return result;
}

/** A link end as an id — d3-force swaps ids for node objects once it runs. */
export function endId(end: string | { id: string }): string {
  return typeof end === 'string' ? end : end.id;
}
