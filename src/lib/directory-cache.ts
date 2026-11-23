"use client";

import type { StudyList } from "./community";
import { studyDateFromTimestamp } from "./study-day";
import { peekView, putView } from "./view-cache";

export type DirectoryScope = "mine" | "search";

export function directoryKey(scope: DirectoryScope, query: string, offset: number, day = studyDateFromTimestamp(new Date().toISOString())) {
  return `directory:${scope}:${day}:${encodeURIComponent(query.toLowerCase())}:${offset}`;
}

export function knownEmptyDirectory(viewerId: string) {
  return peekView<StudyList>(viewerId, directoryKey("mine", "", 0))?.studies.length === 0;
}

export function rememberEmptyDirectory(viewerId: string) {
  putView(viewerId, directoryKey("mine", "", 0), { studies: [], nextOffset: null });
}

// A directory can have several already-expanded pages when the user comes back.
export function cachedDirectoryPages(viewerId: string, scope: DirectoryScope, query: string, through: number, day: string) {
  const pages: Array<{ key: string; list: StudyList }> = [];
  let offset: number | null = 0;
  while (offset !== null && offset <= through) {
    const key = directoryKey(scope, query, offset, day);
    const list: StudyList | undefined = peekView<StudyList>(viewerId, key);
    if (!list) break;
    pages.push({ key, list });
    offset = list.nextOffset;
  }
  return pages;
}
