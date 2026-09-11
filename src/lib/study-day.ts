const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
