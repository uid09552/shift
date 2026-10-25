/** What `POST …/import/preview` answers: how an upload would be read. */
export interface ImportField {
  key: string;
  required: boolean;
}

export interface ImportPreviewColumn {
  /** 0-based. */
  index: number;
  header: string;
  /** The field this column is read as; null when nothing matches or several columns claim it. */
  field: string | null;
  samples: string[];
}

export interface ImportPreview {
  sheets: string[];
  sheet: string;
  /** Counted from 1, as in the spreadsheet. */
  header_row: number;
  row_count: number;
  fields: ImportField[];
  columns: ImportPreviewColumn[];
  missing_required: string[];
  ambiguous: string[];
}

/** What the user assigned: sent as the import's `mapping` part. */
export interface ImportColumnMapping {
  sheet: string;
  header_row: number;
  /** Field key → 0-based column. */
  columns: Record<string, number>;
}

/** The dialog's answer: import this file, reading it this way. */
export interface ImportConfirmation {
  file: File;
  mapping: ImportColumnMapping;
}

/** The multipart body of an import or a preview: the file and any text parts. */
export function importFormData(file: File, parts: Record<string, string | undefined> = {}): FormData {
  const form = new FormData();
  form.append('file', file);
  for (const [name, value] of Object.entries(parts)) {
    if (value !== undefined) form.append(name, value);
  }
  return form;
}
