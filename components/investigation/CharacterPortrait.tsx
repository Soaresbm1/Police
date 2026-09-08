import { portraitService } from "@/lib/game-engine/portraits/portrait-service";
import { GeneratedImageWithFallback } from "./GeneratedImageWithFallback";

/**
 * Drop-in replacement for `<Avatar seed={...} name={...} size={...} />`
 * everywhere a character's portrait is shown. Always renders the
 * procedural portrait immediately (unchanged — still `portraitService`,
 * still synchronous, still zero network cost); if `generatedSrc` is
 * provided (a signed Supabase Storage URL, already resolved server-side
 * by `lib/art/generation/portrait-lookup.ts#getReadyPortraitUrls` — never
 * resolved inside this component, never triggers generation), it cross-
 * fades in once loaded and silently stays procedural on any load
 * failure/expiry.
 *
 * This component itself does no async work and no data fetching — the
 * page that renders it is responsible for calling `getReadyPortraitUrls`
 * ONCE and passing the per-person result down, so a list of many people
 * costs one batched lookup, not one per portrait.
 */
export function CharacterPortrait({
  seed,
  name,
  size = 40,
  generatedSrc,
}: {
  seed: string;
  name: string;
  size?: number;
  generatedSrc?: string | null;
}) {
  const proceduralSrc = portraitService.getPortraitUrl(seed, name);

  return (
    <div className="shrink-0 border border-border-strong" style={{ width: size, height: size }}>
      <GeneratedImageWithFallback proceduralSrc={proceduralSrc} generatedSrc={generatedSrc} className="h-full w-full" alt="" />
    </div>
  );
}
