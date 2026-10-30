import { csvField, toCsv } from './csv';

describe('CSV', () => {
  it('leaves plain fields alone and empties nulls', () => {
    expect(csvField('ICU')).toBe('ICU');
    expect(csvField(3.5)).toBe('3.5');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes commas, semicolons, quotes and line breaks, doubling quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('Krank; Attest folgt')).toBe('"Krank; Attest folgt"');
    expect(csvField('sagte "später"')).toBe('"sagte ""später"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('keeps umlauts and starts with a byte-order mark, lines ending in CRLF', () => {
    const csv = toCsv(['Name', 'Grund'], [['Jürgen Müller', 'Übergabe'], ['Ben', null]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Name,Grund\r\nJürgen Müller,Übergabe\r\nBen,\r\n');
  });
});
