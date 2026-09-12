import type { StudyRuleConfig } from "./rules";

export type RuleVersionRow = {
  effective_from: string;
  rule_config: unknown;
  postpone_deadline_hour: number;
  postpone_deadline_minute: number;
  max_consecutive_postpone: number;
  max_presolve_days: number;
  changed_by?: string | null;
  created_at?: string;
};

export type EffectiveRules = {
  effectiveFrom: string;
  ruleConfig: StudyRuleConfig;
  postponeDeadlineHour: number;
  postponeDeadlineMinute: number;
  maxConsecutivePostpone: number;
  maxPresolveDays: number;
};

export function normalizeRuleVersions(
  rows: RuleVersionRow[],
  normalizeRuleConfig: (value: unknown) => StudyRuleConfig,
): EffectiveRules[] {
  return rows
    .map((row) => ({
      effectiveFrom: row.effective_from,
      ruleConfig: normalizeRuleConfig(row.rule_config),
      postponeDeadlineHour: row.postpone_deadline_hour,
      postponeDeadlineMinute: row.postpone_deadline_minute,
      maxConsecutivePostpone: row.max_consecutive_postpone,
      maxPresolveDays: row.max_presolve_days,
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function rulesForDate(versions: EffectiveRules[], date: string, fallback: EffectiveRules): EffectiveRules {
  let selected = fallback;
  for (const version of versions) {
    if (version.effectiveFrom > date) break;
    selected = version;
  }
  return selected;
}
