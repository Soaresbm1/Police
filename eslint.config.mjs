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
]);

export default eslintConfig;
