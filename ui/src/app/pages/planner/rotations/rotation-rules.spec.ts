import { Shift } from '../../../shared/services/shift.service';
import { checkPattern, formatSequence, parseSequence } from './rotation-rules';

function shift(id: string, short: string, start: string, end: string, freeAfter = 0): Shift {
  return {
    id,
    name: id,
    short_name: short,
    color: '#000',
    order: 0,
    weekday_times: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday, start_time: start, end_time: end, min_employees: 1, max_employees: null, free_days_after_shift: freeAfter,
    })),
  };
}

const early = shift('early', 'F', '06:00:00', '14:00:00');
const late = shift('late', 'S', '14:00:00', '22:00:00');
const night = shift('night', 'N', '22:00:00', '06:00:00');
const shifts = [early, late, night];
const settings = { max_consecutive_days: 6, max_working_days_per_week: 5, min_rest_hours: 11, night_shift_recovery_days: 2 };

describe('rotation rules', () => {
  it('reads a typed sequence by short name or name, with - for a day off', () => {
    expect(parseSequence('F f late, N - x', shifts)).toEqual({
      slots: ['early', 'early', 'late', 'night', null, null],
      unknown: [],
    });
    expect(parseSequence('F Q', shifts).unknown).toEqual(['Q']);
    expect(formatSequence(['early', null, 'night'], shifts)).toBe('F - N');
  });

  it('accepts a rhythm that keeps the rules', () => {
    const slots = parseSequence('F F S S N - - -', shifts).slots;
    expect(checkPattern(slots, shifts, settings)).toEqual([]);
  });

  it('names a late followed by an early, too many days, and work after a night', () => {
    const slots = parseSequence('S F F F F F N F', shifts).slots;
    const kinds = checkPattern(slots, shifts, settings).map((i) => i.kind);
    expect(kinds).toContain('rest'); // S (ends 22:00) → F (06:00): 8 h
    expect(kinds).toContain('weekly');
    expect(kinds).toContain('consecutive');
    expect(kinds).toContain('recovery'); // N then F, with 2 recovery days
  });

  it('checks across the end of the cycle', () => {
    // N at the end, F at the start of the next cycle: no recovery.
    const issues = checkPattern(parseSequence('F - - - N', shifts).slots, shifts, settings);
    expect(issues).toEqual([{ kind: 'recovery', day: 5, shift: 'N', days: 2 }]);
  });
});
