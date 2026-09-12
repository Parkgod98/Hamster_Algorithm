"use client";

import { useEffect } from "react";

export function ClientEnhancements() {
  useEffect(() => {
    const selectManualCount = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== "number" || !target.closest(".manual-form")) return;
      target.select();
    };

    document.addEventListener("focusin", selectManualCount);
    document.addEventListener("click", selectManualCount);
    return () => {
      document.removeEventListener("focusin", selectManualCount);
      document.removeEventListener("click", selectManualCount);
    };
  }, []);

  return null;
}
