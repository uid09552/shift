import { ConfirmedShiftPlan } from '../../../shared/services/confirmed-shift-plan.service';
import { Shift } from '../../../shared/services/shift.service';
import { isoDay, upcomingShifts } from './my-shifts.component';

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1',
  name: 'Early',
  short_name: 'E',
  color: '#3B82F6',
  order: 1,
  weekday_times: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday, start_time: '06:00:00', end_time: '14:00:00', min_employees: 1, max_employees: null, free_days_after_shift: 0,
  })),
  ...over,
});

const plan = (date: string, over: Partial<ConfirmedShiftPlan> = {}): ConfirmedShiftPlan => ({
  id: date, employee_id: 'e1', shift_id: 's1', workstation_id: 'w1', date, is_present: true,
  absence_type: null, creation_type: 'manual', created_at: '', updated_at: '', ...over,
});

describe('upcomingShifts', () => {
  const ws = [{ id: 'w1', name: 'Ward A', available: true, active_shift_ids: [], priority: 'medium', min_employees: 1, max_employees: null }];

  it('lists my next shifts in date order with time and ward, skipping past days, absences and free days', () => {
    const rows = upcomingShifts(
      [plan('2026-12-03'), plan('2026-12-01'), plan('2026-11-20'), plan('2026-12-02', { is_present: false, shift_id: null }), plan('2026-12-04', { shift_id: null })],
      [shift()],
      ws,
      '2026-12-01',
      'en',
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-12-01', '2026-12-03']);
    expect(rows[0]).toEqual(jasmine.objectContaining({ isToday: true, shortName: 'E', time: '06:00–14:00', workstation: 'Ward A' }));
    expect(rows[1].isToday).toBeFalse();
  });

  it('shows at most the limit', () => {
    const plans = Array.from({ length: 5 }, (_, i) => plan(`2026-12-0${i + 1}`));
    expect(upcomingShifts(plans, [shift()], ws, '2026-12-01', 'en', 3).length).toBe(3);
  });

  it('formats local days', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
