"use client";

import { useEffect } from "react";
import { currentAccountSession, onStoredAccountChange } from "@/lib/supabase-browser";
import { syncAccount } from "@/lib/sync-client";

export function ViewSync() {
  useEffect(() => {
    let token: string | undefined;
    let stop: (() => void) | undefined;
    function update() {
      const session = currentAccountSession();
      if (token === session?.access_token) return;
      stop?.(); stop = undefined;
      token = session?.access_token;
      if (session) stop = syncAccount(session);
    }
    update();
    window.addEventListener('hamster-session-start', update);
    const unsubscribe = onStoredAccountChange(update);
    return () => { window.removeEventListener('hamster-session-start', update); unsubscribe(); stop?.(); };
  }, []);
  return null;
}
