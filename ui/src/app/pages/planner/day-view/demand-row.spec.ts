import { demandRow, GanttRow } from './day-view.component';

function row(bars: { ws: string; start: number; end: number }[]): GanttRow {
  return {
    employeeId: 'e', employeeName: 'E', initial: 'E', absence: null, hours: 0,
    bars: bars.map((b) => ({
      startHour: b.start, endHour: b.end, shiftId: 's', shiftName: 'S', shiftShortName: 'S', workstationName: null,
      workstationId: b.ws, timeLabel: '', color: '#000', textColor: '#fff', continuesNextDay: false, continuedFromPrevDay: false, hours: b.end - b.start,
    })),
  };
}

describe('demandRow', () => {
  it('counts who is on duty at each hour of a workstation and names the short runs', () => {
    const need = Array(24).fill(0);
    for (let h = 6; h < 22; h++) need[h] = 1;
    need[10] = need[11] = 2;
    const rows = [row([{ ws: 'w1', start: 6, end: 14 }]), row([{ ws: 'w1', start: 14, end: 22 }]), row([{ ws: 'w2', start: 10, end: 12 }])];
    const d = demandRow('w1', 'ICU', need, rows);
    expect(d.have.slice(5, 23)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(d.shortHours).toEqual(['10–12 (1/2)']);
  });
});
