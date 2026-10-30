/**
 * CSV as RFC 4180 asks: comma-separated, CRLF line ends, a field quoted when
 * it holds a comma, quote, semicolon or line break, quotes doubled inside.
 * Semicolons are quoted too, because a German Excel splits on them. The file
 * starts with a UTF-8 byte-order mark so Excel reads umlauts as umlauts.
 */

const BOM = '﻿';

export type CsvValue = string | number | boolean | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Hand the text to the browser as a file download. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
