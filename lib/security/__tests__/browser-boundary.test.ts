import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActiveGame } from "@/lib/game-session/current";

let activeGame: ActiveGame | null = null;
vi.mock("@/lib/game-session/current", () => ({ getCurrentGame: async () => activeGame }));
vi.mock("@/lib/art/generation/portrait-lookup", async () => {
  const { computeCaseRef } = await import("../case-ref");
  return {
    getReadyPortraitUrls: async (userId: string, truth: ActiveGame["truth"]) =>
      new Map([[truth.victimId, `https://fakeprojectref00000000.supabase.co/storage/v1/object/sign/generated-art/${userId}/${computeCaseRef(truth.seed)}/h.png?token=t`]]),
    hasMissingPortraits: () => false,
  };
});

import AffairePage from "@/app/investigation/affaire/page";
import { CaseIntroOverlay, caseIntroStorageKey } from "@/components/investigation/CaseIntroOverlay";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import { computeCaseRef } from "../case-ref";
import { S1_MASTER_SECRET_ENV } from "../s1-keys";

const REPO_ROOT = path.resolve(__dirname, "../../..");

beforeAll(() => {
  process.env[S1_MASTER_SECRET_ENV] = randomBytes(32).toString("base64url");
});
afterAll(() => {
  delete process.env[S1_MASTER_SECRET_ENV];
});

function gameFor(seed: string): ActiveGame {
  const truth = generateCase(seed, { difficulty: "investigator" });
  return {
    userId: "user-boundary",
    truth,
    session: {
      id: "user-boundary",
      sessionUuid: "session-boundary",
      seed,
      difficulty: "investigator",
      createdAt: 0,
      currentTime: truth.crimeTimestamp,
      evidenceStatus: {},
      labQueue: [],
      events: [],
      notes: "",
      playerTimeline: [],
      interrogated: {},
      mandates: {},
      surveillance: {},
      board: { nodes: [], edges: [] },
      accusation: null,
      crimeSceneExamined: false,
      crimeSceneInspectedZoneIds: [],
      lastRevealedEvidenceIds: [],
      lastActionMessage: null,
      hintState: { progress: {}, history: [], totalHintsUsed: 0 },
    },
  };
}

/** Every element in the tree a Server Component returned, with its props —
 * i.e. exactly what React would serialize for client components. */
function collectElements(node: unknown, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) node.forEach((child) => collectElements(child, out));
  else if (isValidElement<Record<string, unknown>>(node)) {
    out.push(node);
    for (const value of Object.values(node.props)) collectElements(value, out);
  }
  return out;
}

function propStrings(elements: ReactElement<Record<string, unknown>>[]): string {
  return JSON.stringify(
    elements.map((el) => el.props),
    (_key, value) => (typeof value === "function" || isValidElement(value) ? undefined : value),
  );
}

describe("S1 — the unresolved-case page never hands the seed to the browser", () => {
  for (const [label, seed] of [
    ["strong-format", generateCaseSeed()],
    ["legacy", "CASE-FOWQ1C"],
  ] as const) {
    it(`/investigation/affaire (${label} seed): no prop anywhere in the rendered tree carries the seed`, async () => {
      activeGame = gameFor(seed);
      const tree = await AffairePage();
      const elements = collectElements(tree);

      const intro = elements.find((el) => el.type === CaseIntroOverlay);
      expect(intro).toBeDefined();
      expect(Object.keys(intro!.props)).not.toContain("seed");
      expect(intro!.props.introKey).toBe(computeCaseRef(seed));

      const serialized = propStrings(elements);
      expect(serialized).not.toContain(seed);
      expect(serialized.toUpperCase()).not.toContain(seed.replace(/^CASE-/, "").replace(/-/g, ""));
    });
  }

  it("the intro's sessionStorage key is the opaque caseRef, never the seed, and differs per case", () => {
    const a = generateCaseSeed();
    const b = generateCaseSeed();
    const keyA = caseIntroStorageKey(computeCaseRef(a));
    expect(keyA).toMatch(/^caseline:intro-shown:cr1_[0-9a-f]{32}$/);
    expect(keyA).not.toContain(a);
    expect(keyA).toBe(caseIntroStorageKey(computeCaseRef(a)));
    expect(keyA).not.toBe(caseIntroStorageKey(computeCaseRef(b)));
  });
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : listSourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

/** Client modules allowed to mention the word `seed` in code, and why. */
const CLIENT_SEED_ALLOWLIST: Record<string, string> = {
  "components/investigation/CCTVAnimatedPlayer.tsx": "local drawing parameter keyed by `cctv-env:<evidenceId>`, not the case seed",
};

/** Comments, and the per-person portrait prop (`seed={person.avatarSeed}` —
 * a `first-last-index` string unrelated to the case seed), are not leaks. */
function codeWithoutBenignSeedMentions(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\bseed=\{[\w.]*[aA]vatarSeed\}/g, "");
}

describe("S1 — static guard on client components", () => {
  it('no "use client" module references a case seed (session.seed / truth.seed / caseSeed / a seed prop)', () => {
    const offenders: string[] = [];
    for (const file of [...listSourceFiles(path.join(REPO_ROOT, "components")), ...listSourceFiles(path.join(REPO_ROOT, "app"))]) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      if (/\b(session|truth|entry)\.seed\b|\bcaseSeed\b/.test(source)) offenders.push(`${relative}: case seed access`);
      if (/\bseed\b/.test(codeWithoutBenignSeedMentions(source)) && !CLIENT_SEED_ALLOWLIST[relative]) offenders.push(`${relative}: mentions seed`);
    }
    expect(offenders).toEqual([]);
  });
});
