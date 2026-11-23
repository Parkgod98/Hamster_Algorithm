"use client";

import { useCallback, useSyncExternalStore } from "react";
import { viewRevision, watchView } from "@/lib/view-cache";

export function useViewRevision(viewer: string, prefix: string) {
  const subscribe = useCallback((notify: () => void) => watchView(viewer, prefix, notify), [viewer, prefix]);
  const snapshot = useCallback(() => viewRevision(viewer, prefix), [viewer, prefix]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
