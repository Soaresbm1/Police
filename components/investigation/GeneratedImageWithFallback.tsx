"use client";

import { useState } from "react";

/**
 * Always shows `proceduralSrc` immediately — never a blank screen while
 * artwork generates (req. 16). If `generatedSrc` is present (resolved
 * server-side, ahead of render, by the read-only portrait lookup — never
 * generated during React rendering itself), it cross-fades in once
 * loaded; a failed, slow, or expired (signed URL past its TTL) generated-
 * image load just leaves the procedural art showing, silently — the
 * `onError` handler hides the broken generated `<img>` rather than
 * letting a broken-image icon sit on top of the working fallback.
 */
export function GeneratedImageWithFallback({
  proceduralSrc,
  generatedSrc,
  alt = "",
  className,
  imgClassName = "",
}: {
  proceduralSrc: string;
  generatedSrc?: string | null;
  alt?: string;
  className?: string;
  /** Extra classes applied to BOTH the procedural and generated `<img>`
   * elements — e.g. `"object-cover"` for a full-bleed background usage
   * (the crime scene) vs. the default fixed-size avatar usage, which
   * needs none. Purely presentational, never affects the fallback logic
   * above. */
  imgClassName?: string;
}) {
  const [generatedLoaded, setGeneratedLoaded] = useState(false);
  const [generatedFailed, setGeneratedFailed] = useState(false);

  const showGenerated = Boolean(generatedSrc) && !generatedFailed;

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={proceduralSrc} alt={alt} className={`block h-full w-full ${imgClassName}`} />
      {showGenerated && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generatedSrc!}
          alt={alt}
          onLoad={() => setGeneratedLoaded(true)}
          onError={() => setGeneratedFailed(true)}
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${imgClassName} ${generatedLoaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
