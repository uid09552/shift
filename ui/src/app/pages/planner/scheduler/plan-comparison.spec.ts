import { DailyPlanEntry, TaskResultDto } from '../../../shared/services/planner.service';
import { Shift } from '../../../shared/services/shift.service';
import { Workstation } from '../../../shared/services/workstation.service';
import { PlanContext, comparePlans, planStats } from './plan-comparison';

// Mon 2026-09-07 … Wed 2026-09-09
const MON = '2026-09-07';
const TUE = '2026-09-08';
const WED = '2026-09-09';

function shift(id: string, start: string, end: string, min: number): Shift {
  return {
    id,
    name: id,
    short_name: id[0].toUpperCase(),
    color: '#000',
    order: 0,
    weekday_times: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday, start_time: start, end_time: end, min_employees: min, max_employees: null, free_days_after_shift: 0,
    })),
  };
}

function station(id: string, shifts: string[], min = 1, available = true): Workstation {
  return { id, name: id, available, active_shift_ids: shifts, priority: 'high', min_employees: min, max_employees: null };
}

const on = (date: string, shiftId: string, workstationId = 'ward'): DailyPlanEntry =>
  ({ date, status: 'assigned', shift_id: shiftId, workstation_id: workstationId });
const off = (date: string): DailyPlanEntry => ({ date, status: 'free' });

function result(plans: Record<string, DailyPlanEntry[]>, period = { start_date: MON, end_date: WED }, objective = 0): TaskResultDto {
  return {
    status: 'optimal',
    objective_value: objective,
    planning_period: period,
    schedule: [],
    employee_plans: Object.entries(plans).map(([id, daily_plan]) => ({ employee_id: id, employee_name: id, daily_plan })),
  };
}

const ctx: PlanContext = {
  shifts: [shift('early', '06:00', '14:00', 1), shift('night', '22:00', '06:00', 0)],
  workstations: [station('ward', ['early', 'night'])],
  closures: [],
  wishes: [],
};

describe('planStats', () => {
  it('counts places short against station and shift minimums', () => {
    // Early needs 1 at the ward every day; Wednesday nobody is on.
    const stats = planStats(result({ anna: [on(MON, 'early'), on(TUE, 'early'), off(WED)] }), ctx);
    expect(stats.assignments).toBe(2);
    expect(stats.placesShort).toBe(1 + 3); // early on Wed, plus the ward's minimum of 1 on every night
  });

  it('does not count a closed station as short', () => {
    const closed: PlanContext = {
      ...ctx,
      closures: [{ id: 'c', workstation_id: 'ward', unavailable_from: MON, unavailable_to: WED }],
    };
    expect(planStats(result({ anna: [off(MON), off(TUE), off(WED)] }), closed).placesShort).toBe(0);
  });

  it('measures hours, a night running past midnight included, and the gap between people who work', () => {
    const plan = result({
      anna: [on(MON, 'night'), on(TUE, 'early'), off(WED)],
      ben: [on(MON, 'early'), off(TUE), off(WED)],
      carl: [off(MON), off(TUE), off(WED)], // works nowhere: not part of the gap
    });
    const stats = planStats(plan, ctx);
    expect(stats.hoursMax).toBe(16);
    expect(stats.hoursMin).toBe(8);
    expect(stats.hoursSpread).toBe(8);
  });

  it('keeps someone in the hours gap who works in the other plan', () => {
    const a = result({ anna: [on(MON, 'early'), off(TUE), off(WED)], ben: [on(MON, 'early'), off(TUE), off(WED)] });
    const b = result({ anna: [on(MON, 'early'), on(TUE, 'early'), off(WED)], ben: [off(MON), off(TUE), off(WED)] });
    const cmp = comparePlans(a, b, ctx);
    expect(cmp.a.hoursSpread).toBe(0);
    expect(cmp.b.hoursSpread).toBe(16); // Ben dropped to nothing in B — that is the point
  });

  it('counts a wish as granted only when that shift is worked that day', () => {
    const withWishes: PlanContext = {
      ...ctx,
      wishes: [
        { id: 'w1', employee_id: 'anna', shift_id: 'early', wish_date: MON },
        { id: 'w2', employee_id: 'anna', shift_id: 'night', wish_date: TUE },
        { id: 'w3', employee_id: 'anna', shift_id: 'early', wish_date: '2026-10-01' }, // outside the period
      ],
    };
    const stats = planStats(result({ anna: [on(MON, 'early'), on(TUE, 'early'), off(WED)] }), withWishes);
    expect(stats.wishesMet).toBe(1);
    expect(stats.wishesTotal).toBe(2);
  });
});

describe('comparePlans', () => {
  it('lists what differs per employee and day: added, removed, changed shift, changed station', () => {
    const a = result({ anna: [on(MON, 'early'), on(TUE, 'early'), off(WED)], ben: [on(MON, 'early'), off(TUE), off(WED)] });
    const b = result({ anna: [on(MON, 'night'), off(TUE), on(WED, 'early')], ben: [on(MON, 'early', 'icu'), off(TUE), off(WED)] });

    const cmp = comparePlans(a, b, ctx);

    const anna = cmp.rows.find((r) => r.employeeId === 'anna')!;
    expect(anna.changes.get(MON)!.kind).toBe('changed');
    expect(anna.changes.get(TUE)!.kind).toBe('removed');
    expect(anna.changes.get(WED)!.kind).toBe('added');
    const ben = cmp.rows.find((r) => r.employeeId === 'ben')!;
    expect(ben.changes.get(MON)!.after!.workstationId).toBe('icu');
    expect(cmp.changedCells).toBe(4);
    expect(cmp.changedEmployees).toBe(2);
    // Most changes first.
    expect(cmp.rows[0].employeeId).toBe('anna');
  });

  it('compares only the days both plans cover', () => {
    const a = result({ anna: [on(MON, 'early'), on(TUE, 'early'), on(WED, 'early')] });
    const b = result({ anna: [off(TUE), on(WED, 'early')] }, { start_date: TUE, end_date: WED });

    const cmp = comparePlans(a, b, ctx);

    expect(cmp.samePeriod).toBeFalse();
    expect(cmp.dates).toEqual([TUE, WED]);
    expect(cmp.changedCells).toBe(1); // Tuesday; Monday is outside B
  });
});
