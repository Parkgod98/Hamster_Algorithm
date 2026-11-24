const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function expectedClosedDay(now: Date) {
  // The 04:05 KST worker has a 60-minute scheduling and execution allowance.
  return addStudyDays(studyDateFromTimestamp(new Date(now.getTime() - 65 * 60_000).toISOString()), -1);
}

export function studyDateFromTimestamp(iso: string, cutoffHour = 4): string {
  const utc = new Date(iso).getTime();
  if (Number.isNaN(utc)) throw new Error("Invalid timestamp");
  const shifted = new Date(utc + SEOUL_OFFSET_MS - cutoffHour * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function addStudyDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

export function studyDayStartTimestamp(date: string, cutoffHour = 4): string {
  const localMidnightUtc = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(localMidnightUtc)) throw new Error("Invalid study date");
  return new Date(localMidnightUtc + cutoffHour * 60 * 60 * 1000 - SEOUL_OFFSET_MS).toISOString();
}

export function studyDayEndExclusiveTimestamp(date: string, cutoffHour = 4): string {
  return studyDayStartTimestamp(addStudyDays(date, 1), cutoffHour);
}


export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}
