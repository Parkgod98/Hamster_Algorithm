"use client";

import { useEffect, useRef } from "react";
import { hasReadRelease, releaseNote, rememberRelease } from "@/lib/release-notes";
import { AppMark } from "./app-brand";
import styles from "./release-notice.module.css";

export function ReleaseNotice({ accountId }: { accountId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !accountId || hasReadRelease(accountId)) return;
    let opener: HTMLElement | null = null;
    const show = () => {
      if (document.visibilityState !== "visible" || document.querySelector("dialog[open]") || hasReadRelease(accountId)) return;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      rememberRelease(accountId);
    };
    function restoreFocus() {
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("main a[href], main button:not(dialog button):not(:disabled)")?.focus({ preventScroll: true });
    }
    // Wait for the calendar or directory to paint. Defer if another dialog is open.
    const timer = window.setTimeout(show, 0);
    document.addEventListener("visibilitychange", show);
    document.addEventListener("close", show, true);
    dialog.addEventListener("close", restoreFocus);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", show);
      document.removeEventListener("close", show, true);
      dialog.removeEventListener("close", restoreFocus);
      if (dialog.open) dialog.close();
    };
  }, [accountId]);

  return <dialog ref={ref} className={styles.notice} aria-labelledby="hamster-release-title">
    <div className={styles.content}>
      <AppMark />
      <h2 id="hamster-release-title" tabIndex={-1}>햄쮸터가 업그레이드됐다 쮸!</h2>
      <ul>{releaseNote.changes.map(change => <li key={change.title}>
        <strong>{change.title}</strong><p>{change.body}</p>
      </li>)}</ul>
      <form method="dialog"><button className={styles.confirm}>확인했쮸!</button></form>
    </div>
  </dialog>;
}
