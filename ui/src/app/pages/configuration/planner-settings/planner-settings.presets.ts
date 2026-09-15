import type { PlannerSettings, PriorityWeights } from '../../../shared/services/planner-settings.service';

/** Settings the UI exposes as a named strength instead of a raw number. */
export type WeightField =
  | 'equality_weight'
  | 'monthly_hours_target_weight'
  | 'weekly_hours_target_weight'
  | 'wish_weight'
  | 'preference_weight'
  | 'skill_downgrade_weight'
  | 'fatigue_weight'
  | 'shift_continuity_weight'
  | 'shift_continuity_week_bonus';

/** Settings the UI exposes as a slider — real quantities, not abstract weights. */
export type SliderField =
  | 'night_shift_recovery_days'
  | 'min_rest_hours'
  | 'max_consecutive_days'
  | 'max_working_days_per_week';

/**
 * The five levels every weight is offered at, ascending. Index 2 is the
 * shipped default for that field, so "Balanced" everywhere reproduces the
 * out-of-the-box behaviour. The solver only cares about the ratios between
 * these numbers, which is why each field needs its own scale.
 */
export const WEIGHT_SCALES: Record<WeightField, readonly number[]> = {
  equality_weight: [0, 10000, 50000, 120000, 300000],
  monthly_hours_target_weight: [0, 200, 1000, 3000, 8000],
  weekly_hours_target_weight: [0, 200, 1000, 3000, 8000],
  wish_weight: [0, 5000, 20000, 50000, 120000],
  preference_weight: [0, 100, 300, 900, 2500],
  skill_downgrade_weight: [0, 50, 200, 600, 1500],
  fatigue_weight: [0, 30, 100, 300, 800],
  shift_continuity_weight: [0, 150, 500, 1500, 4000],
  shift_continuity_week_bonus: [0, 600, 2000, 6000, 15000],
};

/** Labels for the five levels, in scale order. */
export const LEVEL_LABEL_KEYS = [
  'plannerSettings.level.off',
  'plannerSettings.level.low',
  'plannerSettings.level.medium',
  'plannerSettings.level.high',
  'plannerSettings.level.max',
] as const;

export interface PriorityPreset {
  id: string;
  labelKey: string;
  weights: PriorityWeights;
  /** Segments lit on the coverage meter, 1-5. */
  meter: number;
}

/**
 * Workstation priority is three numbers that only mean something relative to
 * each other, so it is offered as one choice: how sharply high-priority
 * stations are staffed before the rest.
 */
export const PRIORITY_PRESETS: readonly PriorityPreset[] = [
  { id: 'ignore', labelKey: 'plannerSettings.priority.ignore', weights: { high: 1000, medium: 1000, low: 1000 }, meter: 1 },
  { id: 'soft', labelKey: 'plannerSettings.priority.soft', weights: { high: 3000, medium: 1000, low: 300 }, meter: 2 },
  { id: 'balanced', labelKey: 'plannerSettings.priority.balanced', weights: { high: 10000, medium: 1000, low: 100 }, meter: 3 },
  { id: 'strict', labelKey: 'plannerSettings.priority.strict', weights: { high: 100000, medium: 1000, low: 10 }, meter: 5 },
];

export interface NightFatigueOption {
  value: number;
  labelKey: string;
  meter: number;
}

export const NIGHT_FATIGUE_OPTIONS: readonly NightFatigueOption[] = [
  { value: 1, labelKey: 'plannerSettings.nightFatigue.same', meter: 1 },
  { value: 1.5, labelKey: 'plannerSettings.nightFatigue.slight', meter: 2 },
  { value: 2, labelKey: 'plannerSettings.nightFatigue.noticeable', meter: 3 },
  { value: 3, labelKey: 'plannerSettings.nightFatigue.strong', meter: 5 },
];

export interface SolverEffort {
  id: string;
  labelKey: string;
  seconds: number;
  workers: number;
  meter: number;
}

export const SOLVER_EFFORTS: readonly SolverEffort[] = [
  { id: 'quick', labelKey: 'plannerSettings.solverEffort.quick', seconds: 30, workers: 4, meter: 1 },
  { id: 'balanced', labelKey: 'plannerSettings.solverEffort.balanced', seconds: 120, workers: 8, meter: 3 },
  { id: 'thorough', labelKey: 'plannerSettings.solverEffort.thorough', seconds: 300, workers: 16, meter: 5 },
];

/** Everything a use-case preset sets. Solver performance is deliberately left alone. */
// Templates tune weights. Whether rotations are kept is a decision about the
// ward, not a weighting, so picking a template never changes it.
export type PresetValues = Omit<
  PlannerSettings,
  'updated_at' | 'solver_time_limit_seconds' | 'solver_num_workers' | 'keep_fixed_assignments'
>;

export interface UseCaseTemplate {
  id: string;
  labelKey: string;
  hintKey: string;
  values: PresetValues;
}

const BALANCED: PresetValues = {
  night_shift_recovery_days: 2,
  min_rest_hours: 11,
  max_consecutive_days: 6,
  max_working_days_per_week: 5,
  equality_weight: 50000,
  priority_weights: { high: 10000, medium: 1000, low: 100 },
  monthly_hours_target_weight: 1000,
  weekly_min_hours: null,
  weekly_max_hours: null,
  weekly_hours_target_weight: 1000,
  preference_weight: 300,
  wish_weight: 20000,
  skill_downgrade_weight: 200,
  fatigue_weight: 100,
  night_shift_fatigue_multiplier: 2,
  shift_continuity_weight: 500,
  shift_continuity_week_bonus: 2000,
  min_staffing_mode: 'soft',
};

/** Shallow-copies the base so a preset never shares its priority object. */
const preset = (overrides: Partial<PresetValues>): PresetValues => ({
  ...BALANCED,
  ...overrides,
  priority_weights: { ...(overrides.priority_weights ?? BALANCED.priority_weights) },
});

/**
 * Starting points, each a complete set of values. Picking one is not a mode —
 * it only writes the fields below, which stay editable afterwards.
 */
export const USE_CASE_TEMPLATES: readonly UseCaseTemplate[] = [
  {
    id: 'balanced',
    labelKey: 'plannerSettings.template.balanced.label',
    hintKey: 'plannerSettings.template.balanced.hint',
    values: preset({}),
  },
  {
    id: 'fairness',
    labelKey: 'plannerSettings.template.fairness.label',
    hintKey: 'plannerSettings.template.fairness.hint',
    values: preset({
      equality_weight: 120000,
      monthly_hours_target_weight: 3000,
      wish_weight: 5000,
      preference_weight: 300,
      shift_continuity_weight: 150,
      shift_continuity_week_bonus: 600,
      fatigue_weight: 300,
      priority_weights: { high: 3000, medium: 1000, low: 300 },
    }),
  },
  {
    id: 'wishes',
    labelKey: 'plannerSettings.template.wishes.label',
    hintKey: 'plannerSettings.template.wishes.hint',
    values: preset({
      wish_weight: 120000,
      preference_weight: 900,
      equality_weight: 10000,
      monthly_hours_target_weight: 1000,
      fatigue_weight: 100,
    }),
  },
  {
    id: 'coverage',
    labelKey: 'plannerSettings.template.coverage.label',
    hintKey: 'plannerSettings.template.coverage.hint',
    values: preset({
      priority_weights: { high: 100000, medium: 1000, low: 10 },
      equality_weight: 10000,
      monthly_hours_target_weight: 200,
      wish_weight: 5000,
      preference_weight: 100,
      skill_downgrade_weight: 50,
      fatigue_weight: 30,
      night_shift_recovery_days: 1,
      min_rest_hours: 10,
      max_consecutive_days: 7,
      max_working_days_per_week: 6,
    }),
  },
  {
    id: 'stability',
    labelKey: 'plannerSettings.template.stability.label',
    hintKey: 'plannerSettings.template.stability.hint',
    values: preset({
      shift_continuity_weight: 4000,
      shift_continuity_week_bonus: 15000,
      equality_weight: 50000,
      wish_weight: 20000,
      skill_downgrade_weight: 600,
    }),
  },
  {
    id: 'wellbeing',
    labelKey: 'plannerSettings.template.wellbeing.label',
    hintKey: 'plannerSettings.template.wellbeing.hint',
    values: preset({
      fatigue_weight: 800,
      night_shift_fatigue_multiplier: 3,
      night_shift_recovery_days: 3,
      min_rest_hours: 12,
      max_consecutive_days: 5,
      max_working_days_per_week: 5,
      equality_weight: 120000,
      wish_weight: 50000,
      preference_weight: 900,
      shift_continuity_weight: 1500,
      shift_continuity_week_bonus: 6000,
      weekly_max_hours: 45,
      priority_weights: { high: 3000, medium: 1000, low: 300 },
    }),
  },
];
