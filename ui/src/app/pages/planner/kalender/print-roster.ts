/**
 * The printable ward roster: one landscape page per workstation, employee rows ×
 * day columns, shift codes with a legend, the month's status and the print date
 * in the footer. Black-and-white friendly — codes and a hatch for absences, never
 * colour alone. Pure: the Schedule page flattens what it shows into `PrintInput`
 * and prints the returned document (the browser's print dialog also saves a PDF).
 */

export interface PrintDay {
  iso: string;
  /** "Mon 02", already localised. */
  label: string;
  weekend: boolean;
}

/** What one person does on one day. */
export type PrintEntry =
  | { kind: 'shift'; code: string; name: string; workstationId: string | null; workstationName: string }
  | { kind: 'absence'; code: string; name: string };

export interface PrintInput {
  /** "Roster · December 2026". */
  title: string;
  paper: 'A4' | 'A3';
  days: PrintDay[];
  people: { id: string; name: string }[];
  /** Key `${personId}|${iso}`. */
  entries: Map<string, PrintEntry>;
  /** Shown on the "no workstation" page. */
  noWorkstationLabel: string;
  /** "Published", "Draft"… per page footer. */
  statusLabel: string;
  printedLabel: string;
  legendTitle: string;
  employeeHeader: string;
  /** Mark on days someone works on another ward than the page's. */
  elsewhere: string;
  emptyLabel: string;
}

export function entryKey(personId: string, iso: string): string {
  return `${personId}|${iso}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface Ward {
  id: string | null;
  name: string;
}

/** Workstations anyone is planned on in the period, in name order; "no workstation" last. */
export function wardsOf(input: PrintInput): Ward[] {
  const wards = new Map<string | null, string>();
  for (const e of input.entries.values()) {
    if (e.kind === 'shift') wards.set(e.workstationId, e.workstationId ? e.workstationName : input.noWorkstationLabel);
  }
  return [...wards]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
}

/** People planned on the ward at least once in the period, in the grid's order. */
export function peopleOn(input: PrintInput, ward: Ward): { id: string; name: string }[] {
  return input.people.filter((p) =>
    input.days.some((d) => {
      const e = input.entries.get(entryKey(p.id, d.iso));
      return e?.kind === 'shift' && e.workstationId === ward.id;
    }),
  );
}

function cell(input: PrintInput, ward: Ward, personId: string, day: PrintDay, legend: Map<string, string>): string {
  const cls = day.weekend ? 'we' : '';
  const e = input.entries.get(entryKey(personId, day.iso));
  if (!e) return `<td class="${cls}"></td>`;
  if (e.kind === 'absence') {
    legend.set(e.code, e.name);
    return `<td class="${cls} abs">${escapeHtml(e.code)}</td>`;
  }
  if (e.workstationId !== ward.id) return `<td class="${cls} else">${escapeHtml(input.elsewhere)}</td>`;
  legend.set(e.code, e.name);
  return `<td class="${cls}">${escapeHtml(e.code)}</td>`;
}

function page(input: PrintInput, ward: Ward, last: boolean): string {
  const people = peopleOn(input, ward);
  const legend = new Map<string, string>();
  const head = input.days
    .map((d) => `<th class="${d.weekend ? 'we' : ''}">${escapeHtml(d.label)}</th>`)
    .join('');
  const rows = people
    .map(
      (p) =>
        `<tr><th scope="row" class="name">${escapeHtml(p.name)}</th>${input.days
          .map((d) => cell(input, ward, p.id, d, legend))
          .join('')}</tr>`,
    )
    .join('');
  const legendHtml = [...legend]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, name]) => `<li><b>${escapeHtml(code)}</b> ${escapeHtml(name)}</li>`)
    .join('');
  return `<section class="ward${last ? ' last' : ''}" data-ward="${escapeHtml(ward.name)}">
<h1>${escapeHtml(ward.name)} <span>${escapeHtml(input.title)}</span></h1>
<table><thead><tr><th class="name">${escapeHtml(input.employeeHeader)}</th>${head}</tr></thead><tbody>${rows}</tbody></table>
<div class="foot"><ul class="legend" aria-label="${escapeHtml(input.legendTitle)}">${legendHtml}</ul>
<p>${escapeHtml(input.statusLabel)} · ${escapeHtml(input.printedLabel)}</p></div>
</section>`;
}

/** The whole document, ready for an iframe's `srcdoc`. */
export function buildPrintRoster(input: PrintInput): string {
  const wards = wardsOf(input);
  const body = wards.length
    ? wards.map((w, i) => page(input, w, i === wards.length - 1)).join('\n')
    : `<p>${escapeHtml(input.emptyLabel)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>
@page { size: ${input.paper} landscape; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter Variable', Inter, Arial, sans-serif; color: #000; font-size: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ward { page-break-after: always; break-after: page; }
.ward.last { page-break-after: auto; break-after: auto; }
h1 { font-size: 12pt; font-weight: 500; margin: 0 0 3mm; }
h1 span { font-weight: 350; margin-left: 4mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 0.2mm solid #000; padding: 0.6mm 0.4mm; text-align: center; font-size: 6.5pt; overflow: hidden; white-space: nowrap; line-height: 1.25; font-variant-numeric: tabular-nums; }
th.name { width: 38mm; text-align: left; padding-left: 1mm; font-weight: 500; }
tbody th.name { font-weight: 400; }
thead th { font-weight: 500; }
.we { background: #e5e5e5; }
td.abs { background: repeating-linear-gradient(45deg, #fff, #fff 1mm, #cfcfcf 1mm, #cfcfcf 1.4mm); font-weight: 500; }
td.else { color: #444; }
.foot { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; margin-top: 3mm; font-size: 7pt; }
.legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 1mm 5mm; }
.foot p { margin: 0; white-space: nowrap; }
</style></head><body>
${body}
</body></html>`;
}
