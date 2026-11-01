import { coverageGrid } from './coverage-grid';
import { factsPayload } from './testing';

describe('coverageGrid', () => {
  it('marks a short night behind a fully staffed day', () => {
    const grid = coverageGrid(
      factsPayload('2026-11-05', '2026-11-06', [
        ['2026-11-05', 0, 0],
        ['2026-11-05', 1, 0],
        ['2026-11-06', 0, 0],
        ['2026-11-06', 1, 0],
        ['2026-11-06', 2, 1],
      ]),
    );
    expect(grid.dates).toEqual(['2026-11-05', '2026-11-06']);
    const [day, night] = grid.rows;
    expect(day.cells[0]).toEqual(jasmine.objectContaining({ staffed: 2, min: 2, isShort: false }));
    expect(night.cells[0]).toEqual(jasmine.objectContaining({ staffed: 0, min: 1, short: 1, isShort: true }));
    expect(night.cells[0].shortStations).toEqual([{ name: 'ICU', short: 1 }]);
    expect(night.cells[1].isShort).toBeFalse();
    expect(grid.shortCells).toBe(1);
  });

  it('ignores the minimums of a closed workstation', () => {
    const grid = coverageGrid(
      factsPayload('2026-11-06', '2026-11-06', [], [{ from: '2026-11-06', to: '2026-11-06' }]),
    );
    expect(grid.shortCells).toBe(0);
    for (const row of grid.rows) {
      expect(row.cells[0]).toEqual(jasmine.objectContaining({ min: 0, isShort: false }));
    }
  });

  it('marks a shift short when only a workstation under it is', () => {
    const payload = factsPayload('2026-11-05', '2026-11-05', [
      ['2026-11-05', 0, 0],
      ['2026-11-05', 1, 0],
    ]);
    payload.dims.workstations.push({
      id: 'er', name: 'ER', available: true, active_shift_ids: ['day'], min: 1, max: null, closures: [],
    });
    const day = coverageGrid(payload).rows[0].cells[0];
    expect(day.short).toBe(0);
    expect(day.shortStations).toEqual([{ name: 'ER', short: 1 }]);
    expect(day.isShort).toBeTrue();
  });

  it('leaves out a shift with no bounds on any day in view', () => {
    const payload = factsPayload('2026-11-05', '2026-11-05', []);
    payload.dims.shifts[1].weekday = [];
    const grid = coverageGrid(payload);
    expect(grid.rows.map((r) => r.shiftId)).toEqual(['day']);
  });
});
