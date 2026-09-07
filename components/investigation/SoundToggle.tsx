"use client";

import { useEffect, useState } from "react";
import { isSoundMuted, onSoundMuteChange, playSound, setSoundMuted } from "@/lib/sound/sound-manager";

export function SoundToggle() {
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    // Deliberate: localStorage isn't available during server rendering, so
    // the real preference can only be read after mount. Rendering `true`
    // until then keeps the server and first client paint identical (no
    // hydration mismatch); this corrects it immediately after.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(isSoundMuted());
    return onSoundMuteChange(setMuted);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setSoundMuted(next);
        if (!next) playSound("click");
      }}
      title={muted ? "Activer le son" : "Couper le son"}
      className="rounded px-2 py-1 text-xs text-muted hover:text-foreground"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
