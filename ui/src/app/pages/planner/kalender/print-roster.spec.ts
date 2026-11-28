import { PrintEntry, PrintInput, buildPrintRoster, entryKey, peopleOn, wardsOf } from './print-roster';

const days = [
  { iso: '2026-12-04', label: 'Fri 04', weekend: false },
  { iso: '2026-12-05', label: 'Sat 05', weekend: true },
];

function input(entries: [string, string, PrintEntry][]): PrintInput {
  return {
    title: 'Roster · December 2026',
    paper: 'A4',
    days,
    people: [
      { id: 'a', name: 'Anna <Berg>' },
      { id: 'b', name: 'Ben Roth' },
      { id: 'c', name: 'Cem Aydin' },
    ],
    entries: new Map(entries.map(([p, d, e]) => [entryKey(p, d), e])),
    noWorkstationLabel: 'No workstation',
    statusLabel: 'Published',
    printedLabel: 'Printed 28 Nov 2026',
    legendTitle: 'Legend',
    employeeHeader: 'Employee',
    elsewhere: '↗',
    emptyLabel: 'Nothing planned',
  };
}

const shift = (code: string, ws: string | null, wsName = ws ?? ''): PrintEntry => ({
  kind: 'shift', code, name: code === 'E' ? 'Early' : 'Night', workstationId: ws, workstationName: wsName,
});

describe('print roster', () => {
  const data = input([
    ['a', '2026-12-04', shift('E', 'icu', 'ICU')],
    ['a', '2026-12-05', { kind: 'absence', code: 'S', name: 'Sick' }],
    ['b', '2026-12-04', shift('N', 'er', 'ER')],
    ['b', '2026-12-05', shift('E', 'icu', 'ICU')],
    ['c', '2026-12-05', shift('E', null)],
  ]);

  it('makes one page per workstation, no-workstation last', () => {
    expect(wardsOf(data).map((w) => w.name)).toEqual(['ER', 'ICU', 'No workstation']);
    expect((buildPrintRoster(data).match(/<section/g) ?? []).length).toBe(3);
  });

  it('lists on a ward only people planned there, in the grid order', () => {
    const icu = wardsOf(data).find((w) => w.id === 'icu')!;
    expect(peopleOn(data, icu).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('marks days worked on another ward and shows absences and a legend', () => {
    const html = buildPrintRoster(data);
    const icuPage = html.split('<section').find((s) => s.includes('data-ward="ICU"'))!;
    expect(icuPage).toContain('<td class="">E</td>');
    expect(icuPage).toContain('class="we abs">S</td>');
    expect(icuPage).toContain('<td class="we">E</td>');
    expect(icuPage).toContain('<b>S</b> Sick');
    const erPage = html.split('<section').find((s) => s.includes('data-ward="ER"'))!;
    expect(erPage).toContain('class="we else">↗</td>');
  });

  it('escapes names, sets the paper and puts status and date in the footer', () => {
    const html = buildPrintRoster({ ...data, paper: 'A3' });
    expect(html).toContain('Anna &lt;Berg&gt;');
    expect(html).not.toContain('Anna <Berg>');
    expect(html).toContain('size: A3 landscape');
    expect(html).toContain('Published · Printed 28 Nov 2026');
  });

  it('says so when nothing is planned', () => {
    expect(buildPrintRoster(input([]))).toContain('Nothing planned');
  });
});
