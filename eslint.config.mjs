import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Unity prototype (Phase U1+) — its own separate project
    // (C# source + generated WebGL build output), not part of the Next.js
    // app; never meant to be linted by this config.
    "unity/**",
    // Generated Unity WebGL runtime files copied into public/ for the
    // embedded CCTV renderer (Phase U3) — machine-generated Emscripten/
    // IL2CPP output, not CASELINE source.
    "public/unity/**",
  ]),
  // Living Investigation System hardening: MandateRecord.granted is the
  // real, deterministic bank/search-warrant decision, computed and
  // stored at request time but not meant to be player-visible until its
  // InvestigationEvent resolves to "ready" (see mandates.ts#describeMandateEvent).
  // Reading `.granted` directly anywhere outside the files below bypasses
  // that gate — this rule makes doing so a lint error instead of relying
  // on convention, so a future change can't accidentally reintroduce the
  // leak this milestone closed.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "lib/game-session/mandates.ts",
      "lib/game-session/scoring.ts",
      "lib/game-session/persistence/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='granted']",
          message:
            "Do not read MandateRecord.granted directly — the decision must stay hidden until its InvestigationEvent resolves. Use describeMandateEvent()/getMandateOverview() from lib/game-session/mandates.ts instead.",
        },
      ],
    },
  },
  // Phase U5.1 — the crime-reconstruction subsystem's server-only boundary.
  // reconstruction-projector.ts/-layout.ts/-events.ts all import CaseTruth
  // (or CaseTruth-adjacent types) and are marked `import "server-only"`,
  // but that only fails a *build* that actually bundles them into client
  // code — this rule turns an accidental import of the wrong file into a
  // lint error immediately, before a build is even attempted. Only
  // `reconstruction-types.ts` (pure, CaseTruth-free) is meant to ever be
  // imported from outside this folder.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/game-engine/reconstruction/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/reconstruction/reconstruction-projector", "**/reconstruction/reconstruction-layout", "**/reconstruction/reconstruction-events"],
              message:
                "Import only lib/game-engine/reconstruction/reconstruction-types.ts outside the reconstruction subsystem itself — reconstruction-projector.ts/-layout.ts/-events.ts are server-only and must never be reachable from client code.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
