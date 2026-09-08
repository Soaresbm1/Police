import type { GeneratedAssetProvider, GeneratedAssetResult } from "../generated-asset-provider";
import type { GeneratedAssetKind } from "./types";
import { hashSeed } from "../hash";

/**
 * A `GeneratedAssetProvider` implementation for tests ONLY — deterministic,
 * no network call, no vendor dependency. Never registered as the active
 * `generatedAssetProvider` singleton; exists purely so the full pipeline
 * lifecycle (missing → queued → generating → ready) can be exercised in
 * Vitest without ever calling a paid image API (req. 14: "Tests MUST use a
 * mock provider").
 */
export class MockGeneratedAssetProvider implements GeneratedAssetProvider {
  calls: { kind: GeneratedAssetKind; prompt: string; seed: string }[] = [];

  async generate(kind: GeneratedAssetKind, prompt: string, seed: string): Promise<GeneratedAssetResult | null> {
    this.calls.push({ kind, prompt, seed });
    const hue = hashSeed(`${kind}:${seed}`) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="hsl(${hue},50%,50%)" /></svg>`;
    return {
      bytes: new TextEncoder().encode(svg),
      contentType: "image/svg+xml",
      width: 8,
      height: 8,
      model: "mock-v1",
    };
  }
}

/** A provider whose `generate()` always returns `null` — for exercising
 * the "provider unavailable" branch of the pipeline in tests. */
export class AlwaysMissingGeneratedAssetProvider implements GeneratedAssetProvider {
  async generate(): Promise<GeneratedAssetResult | null> {
    return null;
  }
}
