"use client";

import { useEffect, useState } from "react";

const HINTS_DISABLED_KEY = "caseline:hints-disabled";

export function OnboardingHint({ id, text }: { id: string; text: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(HINTS_DISABLED_KEY) === "true") return;
      if (localStorage.getItem(`caseline:hint-dismissed:${id}`) === "true") return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    } catch {
      // localStorage unavailable — skip the hint rather than risk an error
    }
  }, [id]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(`caseline:hint-dismissed:${id}`, "true");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const disableAll = () => {
    try {
      localStorage.setItem(HINTS_DISABLED_KEY, "true");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div className="fade-up flex flex-wrap items-start gap-2 border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
      <span className="text-accent-strong">▸</span>
      <span className="min-w-0 flex-1 text-foreground">{text}</span>
      <button type="button" onClick={disableAll} className="min-h-9 shrink-0 px-1 text-muted hover:text-foreground">
        Désactiver les astuces
      </button>
      <button type="button" onClick={dismiss} className="min-h-9 shrink-0 px-1 font-data text-muted hover:text-foreground" aria-label="Fermer">
        [x]
      </button>
    </div>
  );
}
