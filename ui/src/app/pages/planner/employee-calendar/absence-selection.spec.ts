import { NO_SELECTION, click, daysBetween, daysOf, inSelection, isComplete } from './absence-selection';

describe('absence selection', () => {
  it('sets the start on the first click and the end on the second', () => {
    const first = click(NO_SELECTION, '2026-10-12');
    expect(first).toEqual({ start: '2026-10-12', end: null });
    expect(isComplete(first)).toBeFalse();

    const second = click(first, '2026-10-16');
    expect(second).toEqual({ start: '2026-10-12', end: '2026-10-16' });
    expect(daysOf(second)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  });

  it('orders the ends when the second click is earlier', () => {
    const selection = click(click(NO_SELECTION, '2026-10-16'), '2026-10-12');
    expect(selection).toEqual({ start: '2026-10-12', end: '2026-10-16' });
  });

  it('is one day when the same day is clicked twice', () => {
    const selection = click(click(NO_SELECTION, '2026-10-12'), '2026-10-12');
    expect(daysOf(selection)).toEqual(['2026-10-12']);
  });

  it('starts over on a further click', () => {
    const range = click(click(NO_SELECTION, '2026-10-12'), '2026-10-16');
    expect(click(range, '2026-10-20')).toEqual({ start: '2026-10-20', end: null });
  });

  it('has no days while only the start is chosen', () => {
    expect(daysOf(click(NO_SELECTION, '2026-10-12'))).toEqual([]);
    expect(daysOf(NO_SELECTION)).toEqual([]);
  });

  it('runs across months and years', () => {
    expect(daysBetween('2026-10-29', '2026-11-03')).toEqual([
      '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03',
    ]);
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('counts every calendar day over a clock change', () => {
    expect(daysBetween('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(daysBetween('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('shows the chosen days as selected', () => {
    const range = click(click(NO_SELECTION, '2026-10-12'), '2026-10-14');
    expect(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d) => inSelection(range, d)))
      .toEqual([false, true, true, true, false]);
    expect(inSelection(NO_SELECTION, '2026-10-12')).toBeFalse();
  });

  it('previews the range up to the hovered day while the end is open, in either direction', () => {
    const open = click(NO_SELECTION, '2026-10-12');
    expect(inSelection(open, '2026-10-14', '2026-10-15')).toBeTrue();
    expect(inSelection(open, '2026-10-16', '2026-10-15')).toBeFalse();
    // hovering before the start previews the days back to it
    expect(inSelection(open, '2026-10-10', '2026-10-09')).toBeTrue();
    expect(inSelection(open, '2026-10-08', '2026-10-09')).toBeFalse();
    expect(inSelection(open, '2026-10-12')).toBeTrue();
  });
});
