"use client";

import { useState } from "react";

/**
 * Always shows `proceduralSrc` immediately — never a blank screen while
 * artwork generates (req. 16). If `generatedSrc` is present (resolved
 * server-side, ahead of render, by `lib/art/generation/pipeline.ts` —
 * never generated during React rendering itself), it cross-fades in once
 * loaded; a failed/slow generated-image load just leaves the procedural
 * art showing, silently. Not wired to any live generation call yet — this
 * is the presentational half, ready for when a provider is chosen.
 */
export function GeneratedImageWithFallback({
  proceduralSrc,
  generatedSrc,
  alt = "",
  className,
}: {
  proceduralSrc: string;
  generatedSrc?: string | null;
  alt?: string;
  className?: string;
}) {
  const [generatedLoaded, setGeneratedLoaded] = useState(false);

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={proceduralSrc} alt={alt} className="block h-full w-full" />
      {generatedSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generatedSrc}
          alt={alt}
          onLoad={() => setGeneratedLoaded(true)}
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${generatedLoaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
