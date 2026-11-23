import type { SyncHint as Hint, SyncSnapshot } from './sync-stream';

function since(before: string, after: string, history: Hint[]) {
  if (before === after) return [];
  const newer = history.filter(h => BigInt(h.rev) > BigInt(before));
  if (BigInt(after) - BigInt(before) !== BigInt(newer.length) ||
      newer.some((h, i) => BigInt(h.rev) !== BigInt(before) + BigInt(i + 1))) return null;
  return newer;
}

export function changedViews(previous: SyncSnapshot, next: SyncSnapshot) {
  const prefixes = new Set<string>();
  const members = new Map<string, Set<string>>();
  const add = (...values: string[]) => values.forEach(key => prefixes.add(key));
  const wholeStudy = (s: string) => add(`calendar:${s}:`, `day:${s}:`, `photo:${s}:`, `growth:${s}:`, `penalty:${s}:`,
    `manage:${s}`, `history:${s}`, `member-progress:${s}:`, 'directory:', 'invite:');
  if (previous.catalog !== next.catalog) add('directory:search:', 'invite:');
  const account = since(previous.account, next.account, next.changes.account);
  if (account === null) add('profile', 'repos', 'push:', 'directory:', 'invite:', 'manage:');
  for (const hint of account ?? []) {
    switch (hint.kind) {
      case 'mine': add('directory:', 'invite:'); break;
      case 'manage': add(hint.studyId ? `manage:${hint.studyId}` : 'manage:'); break;
      case 'profile': add('profile'); break;
      case 'repos': add('repos'); break;
      case 'push': add('push:'); break;
      default: add('profile', 'repos', 'push:', 'directory:', 'invite:', 'manage:');
    }
  }
  for (const study of new Set([...Object.keys(previous.studies), ...Object.keys(next.studies)])) {
    const a = previous.studies[study], b = next.studies[study];
    if (a === undefined || b === undefined) { wholeStudy(study); continue; }
    const hints = since(a, b, next.changes.studies[study] ?? []);
    if (!hints) { wholeStudy(study); continue; }
    for (const hint of hints) {
      const d = hint.date;
      if (hint.kind === 'rules') {
        add(`calendar:${study}:`, `day:${study}:`, `history:${study}`, `member-progress:${study}:`, 'directory:', 'invite:');
      } else if (hint.kind === 'metadata') {
        add(`calendar:${study}:`, `manage:${study}`, 'directory:', 'invite:');
      } else if (hint.kind === 'penalty' && d) {
        add(`penalty:${study}:${d.slice(0, 7)}`, `day:${study}:${d}`);
      } else if (['goal', 'submission', 'postponement'].includes(hint.kind) && hint.userId && d) {
        const users = members.get(study) ?? new Set<string>();
        users.add(hint.userId); members.set(study, users);
        if (hint.kind !== 'postponement') add(`day:${study}:${d}`);
        if (hint.kind === 'goal' && hint.id) add(`photo:${study}:${hint.id}`);
        if (hint.kind === 'submission') {
          // A growth report includes this month and the two preceding months.
          for (let offset = 0; offset <= 2; offset++) {
            const month = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1 + offset, 1)).toISOString().slice(0, 7);
            add(`growth:${study}:${hint.userId}:${month}`);
          }
        }
      } else { wholeStudy(study); }
    }
    if (prefixes.has(`calendar:${study}:`)) members.delete(study);
  }
  return { prefixes: [...prefixes], members };
}
