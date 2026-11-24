import content from "./release-note-content.json" with { type: "json" };
export const releaseNote = content;

let lastInMemory: { accountId: string; version: number } | null = null;

export function hasReadRelease(accountId: string, version = releaseNote.version) {
  if (lastInMemory?.accountId === accountId && lastInMemory.version >= version) return true;
  try {
    return Number(localStorage.getItem("hamster-release:" + accountId)) >= version;
  } catch { return false; }
}

export function rememberRelease(accountId: string, version = releaseNote.version) {
  if (hasReadRelease(accountId, version)) return;
  lastInMemory = { accountId, version };
  try { localStorage.setItem("hamster-release:" + accountId, String(version)); }
  catch { /* A browser with restricted storage still remembers this visit. */ }
}
