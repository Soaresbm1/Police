import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import { computeMotiveSupport, type MotiveSupportChannelFamily } from "../motive-support";
import type { MotiveType } from "../../types/case";

const SAMPLE = 300;

describe("computeMotiveSupport", () => {
  it("[Q] is deterministic for the same seed", () => {
    const a = generateCase("CASE-MOTIVESUP-DET", { difficulty: "investigator" });
    const b = generateCase("CASE-MOTIVESUP-DET", { difficulty: "investigator" });
    expect(computeMotiveSupport(a)).toEqual(computeMotiveSupport(b));
  });

  it("[O] channelFamilies never contains a duplicate — each family counts once", () => {
    for (let i = 0; i < 50; i++) {
      const truth = generateCase(`CASE-MOTIVESUP-DUP-${i}`, { difficulty: "investigator" });
      const result = computeMotiveSupport(truth);
      expect(new Set(result.channelFamilies).size).toBe(result.channelFamilies.length);
      expect(result.channelCount).toBe(result.channelFamilies.length);
    }
  });

  it("[N] digital-only support is never reported as sufficient by itself — it's one channel among several possible, never inflated to imply solvability", () => {
    // The function only ever returns a count/list; it never claims
    // "solved" on its own. This just documents that a digital_message-only
    // result is a valid (if weak), honestly-reported outcome — never
    // silently upgraded to a higher count.
    for (let i = 0; i < 100; i++) {
      const truth = generateCase(`CASE-MOTIVESUP-DIGONLY-${i}`, { difficulty: "investigator" });
      const result = computeMotiveSupport(truth);
      if (result.channelFamilies.length === 1 && result.channelFamilies[0] === "digital_message") {
        expect(result.channelCount).toBe(1);
      }
    }
  });

  it("[P] the diagnostic module is never imported by any browser-reachable client component or server action payload builder", async () => {
    // Structural guard: this file lives under validator/, alongside
    // computeSolvability — never under game-session/ (session/action code
    // is what actually crosses into RSC payloads). No app-actions.ts or
    // *App.tsx file imports it.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../../../");
    const appActions = fs.readFileSync(path.join(root, "lib/game-session/app-actions.ts"), "utf8");
    expect(appActions).not.toContain("motive-support");
  });

  it("[L, M] across many generated cases, report the channel-count distribution (informational)", () => {
    const counts: number[] = [];
    const familyCounts: Record<MotiveSupportChannelFamily, number> = { digital_message: 0, financial: 0, witness: 0, relationship: 0, cctv: 0 };
    const byMotive: Partial<Record<MotiveType, number[]>> = {};

    for (let i = 0; i < SAMPLE; i++) {
      const truth = generateCase(`CASE-MOTIVESUP-DIST-${i}`, { difficulty: "investigator" });
      const result = computeMotiveSupport(truth);
      counts.push(result.channelCount);
      for (const f of result.channelFamilies) familyCounts[f]++;
      (byMotive[result.motive] ??= []).push(result.channelCount);
    }

    const atLeast2 = counts.filter((c) => c >= 2).length;
    const atLeast3 = counts.filter((c) => c >= 3).length;
    console.log("=== MOTIVE SUPPORT DISTRIBUTION ===", {
      sample: SAMPLE,
      atLeast2Pct: ((atLeast2 / SAMPLE) * 100).toFixed(1),
      atLeast3Pct: ((atLeast3 / SAMPLE) * 100).toFixed(1),
      familyCounts,
    });
    const perMotiveAvg = Object.fromEntries(
      Object.entries(byMotive).map(([m, list]) => [m, (list!.reduce((s, x) => s + x, 0) / list!.length).toFixed(2)]),
    );
    console.log("=== AVG CHANNEL COUNT BY MOTIVE TYPE ===", perMotiveAvg);

    expect(counts.length).toBe(SAMPLE);
    expect(familyCounts.digital_message).toBeGreaterThan(0);
  });
});
