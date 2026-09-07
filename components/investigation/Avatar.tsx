import { portraitService } from "@/lib/game-engine/portraits/portrait-service";

export function Avatar({ seed, name, size = 40 }: { seed: string; name: string; size?: number }) {
  const src = portraitService.getPortraitUrl(seed, name);
  // eslint-disable-next-line @next/next/no-img-element -- deterministic data: URI, not an optimizable remote asset
  return <img src={src} alt="" width={size} height={size} className="shrink-0 border border-border-strong" />;
}
