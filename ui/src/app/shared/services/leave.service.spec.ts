import { leaveDays } from './leave.service';

describe('leaveDays', () => {
  it('counts a single day as one', () => {
    expect(leaveDays({ start_date: '2026-12-24', end_date: '2026-12-24' })).toBe(1);
  });

  it('counts both ends of a range', () => {
    expect(leaveDays({ start_date: '2026-12-01', end_date: '2026-12-05' })).toBe(5);
  });

  it('crosses month and year ends, and leap days', () => {
    expect(leaveDays({ start_date: '2026-12-30', end_date: '2027-01-02' })).toBe(4);
    expect(leaveDays({ start_date: '2028-02-28', end_date: '2028-03-01' })).toBe(3);
  });

  it('is not thrown by a daylight-saving change', () => {
    expect(leaveDays({ start_date: '2026-03-27', end_date: '2026-03-30' })).toBe(4);
    expect(leaveDays({ start_date: '2026-10-24', end_date: '2026-10-26' })).toBe(3);
  });
});
