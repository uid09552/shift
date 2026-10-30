import { TranslationService } from '../../../shared/i18n/translation.service';
import { Labels } from './model/charts';
import { dayNumber } from './model/dates';
import { RosterFacts } from './model/facts';

/** Roster change sources the backend writes (ChangeSource). */
export const CHANGE_SOURCES = ['manual', 'take_as_plan', 'absence', 'swap', 'replacement'] as const;

/**
 * Names for what the page shows by id or code: employees, shifts,
 * workstations and capabilities from the roster facts, everything else from
 * the translations, falling back to the raw value — an unknown code is still
 * better shown than hidden.
 */
export class AnalyticsLabels {
  readonly fmt: Labels;
  private readonly names = new Map<string, string>();

  constructor(
    private readonly t: TranslationService,
    facts: RosterFacts | undefined,
  ) {
    this.fmt = new Labels(t.locale);
    if (facts) {
      for (const e of facts.employees) this.names.set(`employee:${e.id}`, e.name);
      for (const s of facts.shifts) this.names.set(`shift:${s.id}`, s.name);
      for (const w of facts.workstations) this.names.set(`workstation:${w.id}`, w.name);
      for (const c of facts.capabilities) this.names.set(`capability:${c.id}`, c.name);
    }
  }

  /** The value alone, as a chart axis or table cell shows it. */
  value(dim: string, value: string): string {
    const named = this.names.get(`${dim}:${value}`);
    if (named) return named;
    switch (dim) {
      case 'day':
        return this.fmt.day(dayNumber(value));
      case 'weekday':
        return this.fmt.weekday(+value);
      case 'month':
        return this.fmt.month(value);
      case 'absence':
        return this.translated(`analytics.absence.${value}`, value);
      case 'source':
        return this.translated(`analytics.source.${value}`, value);
      case 'runSource':
        return this.translated(`analytics.runSource.${value}`, value);
      case 'runStatus':
        return this.translated(`analytics.outcome.${value}`, value);
      default:
        return value;
    }
  }

  /** "Dimension: value", as a chip shows it. */
  chip(dim: string, value: string): string {
    return `${this.t.t(`analytics.dim.${dim}`)}: ${this.value(dim, value)}`;
  }

  /** A day number or a bucket ('YYYY-MM-DD' or 'YYYY-MM') as an axis label. */
  bucket(bucket: string): string {
    return bucket.length === 7 ? this.fmt.month(bucket) : this.fmt.day(dayNumber(bucket));
  }

  private translated(key: string, fallback: string): string {
    const text = this.t.t(key);
    return text === key ? fallback : text;
  }
}
