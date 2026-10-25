import {
  GraphInput,
  LINK_TYPES,
  NODE_TYPES,
  RosterEntry,
  applyFilters,
  buildGraph,
  neighbourhood,
} from './relationship-graph';

/** Anna (ICU-qualified, nights), Ben (no capabilities, early); ICU requires ICU care. */
function ward(): GraphInput {
  return {
    employees: [
      { id: 'anna', name: 'Anna', capabilities: [{ id: 'icu' }], available_shifts: [{ id: 'night' }] },
      { id: 'ben', name: 'Ben', capabilities: [], available_shifts: [{ id: 'early' }] },
    ],
    capabilities: [
      { id: 'icu', name: 'Intensive Care' },
      { id: 'surgery', name: 'Surgery' },
    ],
    workstations: [
      { id: 'ws-icu', name: 'ICU', available: true, active_shift_ids: ['early', 'night'] },
      { id: 'ws-old', name: 'Old ward', available: false, active_shift_ids: [] },
    ],
    requiredCapabilities: { 'ws-icu': ['icu'] },
    shifts: [
      { id: 'early', name: 'Early', color: '#22c55e' },
      { id: 'night', name: 'Night', color: '#1e3a8a' },
    ],
  };
}

function entry(employee: string, date: string, shift: string | null, ws: string | null, extra: Partial<RosterEntry> = {}): RosterEntry {
  return { employee_id: employee, date, shift_id: shift, workstation_id: ws, is_present: true, absence_type: null, ...extra };
}

const has = (links: { source: string; target: string; type: string }[], source: string, target: string, type: string) =>
  links.some((l) => l.source === source && l.target === target && l.type === type);

describe('buildGraph', () => {
  it('has one node per employee, capability, workstation and shift, with typed ids', () => {
    const g = buildGraph(ward());
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      ['cap:icu', 'cap:surgery', 'emp:anna', 'emp:ben', 'shift:early', 'shift:night', 'ws:ws-icu', 'ws:ws-old'].sort(),
    );
    expect(g.nodes.find((n) => n.id === 'shift:night')!.color).toBe('#1e3a8a');
  });

  it('links a qualified employee to their capability and shift', () => {
    const g = buildGraph(ward());
    expect(has(g.links, 'emp:anna', 'cap:icu', 'hasCapability')).toBeTrue();
    expect(has(g.links, 'emp:anna', 'shift:night', 'mayWork')).toBeTrue();
  });

  it('links a workstation to what it requires and the shifts it runs', () => {
    const g = buildGraph(ward());
    expect(has(g.links, 'ws:ws-icu', 'cap:icu', 'requires')).toBeTrue();
    expect(has(g.links, 'ws:ws-icu', 'shift:early', 'runs')).toBeTrue();
    expect(has(g.links, 'ws:ws-icu', 'shift:night', 'runs')).toBeTrue();
  });

  it('keeps a closed workstation, marked closed', () => {
    const old = buildGraph(ward()).nodes.find((n) => n.id === 'ws:ws-old')!;
    expect(old.closed).toBeTrue();
  });

  it('draws no link to an item that no longer exists', () => {
    const input = ward();
    input.employees[0].capabilities.push({ id: 'deleted' });
    expect(buildGraph(input).links.some((l) => l.target === 'cap:deleted')).toBeFalse();
  });

  it('marks a capability required by an open workstation and held by fewer than two people', () => {
    const g = buildGraph(ward());
    expect(g.nodes.find((n) => n.id === 'cap:icu')!.spof).toBeTrue();
    // Not required by any open workstation:
    expect(g.nodes.find((n) => n.id === 'cap:surgery')!.spof).toBeFalsy();
  });

  it('does not mark a capability two people hold', () => {
    const input = ward();
    input.employees[1].capabilities.push({ id: 'icu' });
    expect(buildGraph(input).nodes.find((n) => n.id === 'cap:icu')!.spof).toBeFalsy();
  });

  it('does not count a closed workstation for single points of failure', () => {
    const input = ward();
    input.requiredCapabilities['ws-old'] = ['surgery'];
    expect(buildGraph(input).nodes.find((n) => n.id === 'cap:surgery')!.spof).toBeFalsy();
  });

  it('draws no assignments without a roster', () => {
    expect(buildGraph(ward()).links.some((l) => l.type === 'assigned')).toBeFalse();
  });

  it('counts the days of a week in which Anna works Night at ICU three times', () => {
    const roster = ['2026-10-19', '2026-10-20', '2026-10-21'].map((d) => entry('anna', d, 'night', 'ws-icu'));
    const assigned = buildGraph(ward(), roster).links.filter((l) => l.type === 'assigned');
    expect(assigned.length).toBe(2);
    expect(assigned.find((l) => l.target === 'ws:ws-icu')!.days).toBe(3);
    expect(assigned.find((l) => l.target === 'shift:night')!.days).toBe(3);
  });

  it("draws a single day's entry", () => {
    const assigned = buildGraph(ward(), [entry('anna', '2026-10-19', 'early', 'ws-icu')]).links.filter((l) => l.type === 'assigned');
    expect(assigned.map((l) => l.target).sort()).toEqual(['shift:early', 'ws:ws-icu']);
    expect(assigned.every((l) => l.days === 1)).toBeTrue();
  });

  it('draws no assignment for an absence or a day off', () => {
    const roster = [
      entry('anna', '2026-10-19', 'night', 'ws-icu', { is_present: false, absence_type: 'sick' }),
      entry('anna', '2026-10-20', null, null),
    ];
    expect(buildGraph(ward(), roster).links.some((l) => l.type === 'assigned')).toBeFalse();
  });

  it('flags an assignment at a workstation whose requirement the employee lacks', () => {
    const g = buildGraph(ward(), [entry('ben', '2026-10-19', 'early', 'ws-icu'), entry('anna', '2026-10-19', 'night', 'ws-icu')]);
    const at = (emp: string) => g.links.find((l) => l.type === 'assigned' && l.source === emp && l.target === 'ws:ws-icu')!;
    expect(at('emp:ben').uncovered).toBeTrue();
    expect(at('emp:anna').uncovered).toBeFalse();
    // The shift link carries no qualification flag.
    expect(g.links.find((l) => l.source === 'emp:ben' && l.target === 'shift:early' && l.type === 'assigned')!.uncovered).toBeFalse();
  });

  it('builds a 500-node ward quickly', () => {
    const big = largeWard(400, 40, 40, 20);
    const started = performance.now();
    const g = buildGraph(big);
    expect(g.nodes.length).toBe(500);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('applyFilters', () => {
  const all = { nodeTypes: new Set(NODE_TYPES), linkTypes: new Set(LINK_TYPES), search: '' };

  it('hides shift nodes and every link to a shift, and keeps the rest', () => {
    const g = buildGraph(ward());
    const f = applyFilters(g, { ...all, nodeTypes: new Set(NODE_TYPES.filter((t) => t !== 'shift')) });
    expect(f.nodes.some((n) => n.type === 'shift')).toBeFalse();
    expect(f.links.some((l) => l.target.startsWith('shift:'))).toBeFalse();
    expect(has(f.links, 'emp:anna', 'cap:icu', 'hasCapability')).toBeTrue();
  });

  it('hides a link type on its own', () => {
    const f = applyFilters(buildGraph(ward()), { ...all, linkTypes: new Set(LINK_TYPES.filter((t) => t !== 'requires')) });
    expect(f.links.some((l) => l.type === 'requires')).toBeFalse();
    expect(f.nodes.length).toBe(8);
  });

  it('highlights a search match and its direct neighbours', () => {
    const f = applyFilters(buildGraph(ward()), { ...all, search: 'anna' });
    expect([...f.highlighted!].sort()).toEqual(['cap:icu', 'emp:anna', 'shift:night']);
  });

  it('highlights nothing without a search', () => {
    expect(applyFilters(buildGraph(ward()), all).highlighted).toBeNull();
  });
});

describe('neighbourhood', () => {
  it('is a capability, the employees who have it and the workstations that require it', () => {
    const g = buildGraph(ward());
    expect([...neighbourhood(g.links, 'cap:icu')].sort()).toEqual(['cap:icu', 'emp:anna', 'ws:ws-icu']);
  });
});

/** A generated tenant for size checks: every employee holds 3 capabilities and may work 2 shifts. */
export function largeWard(employees: number, capabilities: number, workstations: number, shifts: number): GraphInput {
  const caps = Array.from({ length: capabilities }, (_, i) => ({ id: `c${i}`, name: `Capability ${i}` }));
  const sh = Array.from({ length: shifts }, (_, i) => ({ id: `s${i}`, name: `Shift ${i}`, color: '#888888' }));
  return {
    employees: Array.from({ length: employees }, (_, i) => ({
      id: `e${i}`,
      name: `Employee ${i}`,
      capabilities: [0, 1, 2].map((k) => ({ id: `c${(i + k * 7) % capabilities}` })),
      available_shifts: [0, 1].map((k) => ({ id: `s${(i + k) % shifts}` })),
    })),
    capabilities: caps,
    workstations: Array.from({ length: workstations }, (_, i) => ({
      id: `w${i}`,
      name: `Workstation ${i}`,
      available: true,
      active_shift_ids: [`s${i % shifts}`, `s${(i + 1) % shifts}`],
    })),
    requiredCapabilities: Object.fromEntries(Array.from({ length: workstations }, (_, i) => [`w${i}`, [`c${i % capabilities}`]])),
    shifts: sh,
  };
}
