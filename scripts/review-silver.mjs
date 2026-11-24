// Read-only replay. Input is the anonymous JSON rows from review-silver.sql.
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
const localRequire = createRequire(import.meta.url);

// Compile the same pure functions as the running application.
localRequire.extensions[".ts"] = (mod, name) => {
  const source = ts.transpileModule(fs.readFileSync(name, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  mod._compile(source.outputText, name);
};
const { evaluateTimelineByDay, dateRange, penaltyLevelForBacklog } = localRequire("../src/lib/progress.ts");
const { normalizeRuleConfig, penaltyForConsecutiveMisses, submissionCredit } = localRequire("../src/lib/rules.ts");
const { normalizeRuleVersions, rulesForDate } = localRequire("../src/lib/rule-version.ts");
const { studyDateFromTimestamp, studyDayEndExclusiveTimestamp } = localRequire("../src/lib/study-day.ts");

function affected([,, platform, grade, source]) {
  return platform === "BOJ" && grade.trim().toLowerCase() === "silver" && ["github","backfill"].includes(source);
}

function replayMember(input) {
  const versions = normalizeRuleVersions(input.rules.map(([effective_from, max_presolve_days, max_consecutive_postpone, config, goals]) => ({
    effective_from, max_presolve_days, max_consecutive_postpone,
    rule_config: goals ? { ...config, goals: { ...goals, englishRule: "" } } : config,
  })), normalizeRuleConfig);
  const rules = date => rulesForDate(versions, date);
  const days = dateRange(input.joined, input.asof);
  const postponed = new Set((input.post || []).map(([date]) => date));
  const recorded = new Map(input.penalties || []);
  const goals = (input.goals || []).map(([target, at, goal]) => ({ target, at, goal, earned: studyDateFromTimestamp(at) }));
  const submissions = input.subs || [];
  const directChanges = new Map();
  let outsideMembership = 0;
  for (const row of submissions.filter(affected)) {
    const date = studyDateFromTimestamp(row[0]);
    if (date < input.joined || date > input.asof) {
      outsideMembership++;
      continue;
    }
    const group = directChanges.get(date) || { date, events: 0, extraCredit: 0 };
    group.events++;
    group.extraCredit += 1 / rules(date).ruleConfig.bojSilverCount;
    directChanges.set(date, group);
  }

  function timeline(end, corrected, closing) {
    const cutoff = Date.parse(studyDayEndExclusiveTimestamp(end));
    const byDay = new Map();
    for (const row of submissions) {
      const [at, created, platform, difficulty, source] = row;
      const day = studyDateFromTimestamp(at);
      if (day < input.joined || day > end) continue;
      // Backdated manual assertions made after closure are later repayments.
      // A genuine GitHub solution is dated by its commit, including delayed collection.
      if (closing && source === "manual" && Date.parse(created) >= cutoff) continue;
      const config = rules(day).ruleConfig;
      const credit = corrected && affected(row) ? 1 / config.bojSilverCount : submissionCredit(platform, difficulty, config);
      const group = byDay.get(day) || { credits: 0, creditEvents: [] };
      group.credits += credit;
      group.creditEvents.push({ at, credits: credit });
      byDay.set(day, group);
    }
    return evaluateTimelineByDay(days.filter(d => d <= end).map(date => ({
      date, ...(byDay.get(date) || { credits: 0 }), postponed: postponed.has(date),
    })), end, d => rules(d).maxPresolveDays, d => rules(d).ruleConfig.goals,
      closing ? goals.filter(g => Date.parse(g.at) < cutoff && g.target <= end) : goals);
  }
  const oldDays = timeline(input.asof, false, false);
  const newDays = timeline(input.asof, true, false);
  const changedDays = [];
  const fines = [];
  for (const [i, date] of days.entries()) {
    const before = oldDays[i], after = newDays[i];
    if (before.state !== after.state || before.resolvedOn !== after.resolvedOn || before.backlogCount !== after.backlogCount) {
      changedDays.push({ date, before: before.state, after: after.state, resolvedBefore: before.resolvedOn,
        resolvedAfter: after.resolvedOn, backlogBefore: before.backlogCount, backlogAfter: after.backlogCount });
    }
    if (date === input.asof) continue;
    function fine(corrected) {
      const result = timeline(date, corrected, true).at(-1);
      if (postponed.has(date) || result.state === "complete" || result.backlogCount <= 0) return 0;
      return penaltyForConsecutiveMisses(penaltyLevelForBacklog(result.backlogCount), rules(date).ruleConfig);
    }
    const was = fine(false), wouldBe = fine(true);
    if (recorded.has(date) || was !== wouldBe) {
      fines.push({ date, recorded: recorded.get(date) ?? null, oldModel: was, correctedModel: wouldBe });
    }
  }
  return { alias: input.alias, asOf: input.asof, events: submissions.filter(affected).length,
    eventDays: new Set(submissions.filter(affected).map(([at]) => studyDateFromTimestamp(at))).size,
    outsideMembership, directChanges: [...directChanges.values()].sort((a,b) => a.date.localeCompare(b.date)), changedDays, fines };
}

{
  const input = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
  const rows = Array.isArray(input) ? input : [input];
  process.stdout.write(JSON.stringify(rows.map(replayMember), null, 2) + "\n");
}
