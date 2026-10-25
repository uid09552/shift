import { clearSelection, readSelection, writeSelection } from './remembered-selection';

describe('remembered selection', () => {
  beforeEach(() => localStorage.removeItem('employeeCalendar.selection'));

  it('reads back what was written, with the account that chose it', () => {
    writeSelection('user-1', 'e1');
    expect(readSelection()).toEqual({ sub: 'user-1', employeeId: 'e1' });
    writeSelection(null, 'e2'); // dev mode: no account
    expect(readSelection()).toEqual({ sub: null, employeeId: 'e2' });
  });

  it('has nothing after clearing', () => {
    writeSelection('user-1', 'e1');
    clearSelection();
    expect(readSelection()).toBeNull();
  });

  it('treats a malformed entry as none', () => {
    localStorage.setItem('employeeCalendar.selection', '{not json');
    expect(readSelection()).toBeNull();
    localStorage.setItem('employeeCalendar.selection', JSON.stringify({ sub: 'user-1' }));
    expect(readSelection()).toBeNull();
    localStorage.setItem('employeeCalendar.selection', JSON.stringify({ sub: 7, employeeId: 'e1' }));
    expect(readSelection()).toBeNull();
    clearSelection(); // leave no junk for the next suite
  });

  it('works without storage, remembering nothing', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('denied');
    spyOn(Storage.prototype, 'setItem').and.throwError('denied');
    spyOn(Storage.prototype, 'removeItem').and.throwError('denied');
    expect(() => writeSelection('user-1', 'e1')).not.toThrow();
    expect(() => clearSelection()).not.toThrow();
    expect(readSelection()).toBeNull();
  });
});
