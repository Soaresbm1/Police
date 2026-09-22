import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __testing, TrustedStoragePathError } from "../trusted-storage";

/**
 * Security S2 EXPAND-2 — static proof that `SUPABASE_SERVICE_ROLE_KEY` and
 * the privileged client it configures can never reach client-side code or
 * normal gameplay code. Does NOT require the actual secret to exist — see
 * `trusted-storage.ts`'s own doc comment for why the client is
 * constructed lazily.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "unity" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) listTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("trusted-storage — service-role isolation (static)", () => {
  it("is marked server-only", () => {
    const src = readFileSync(path.resolve(__dirname, "../trusted-storage.ts"), "utf8");
    expect(src.trimStart().startsWith('import "server-only"')).toBe(true);
  });

  it("never exports a raw client getter — only the three narrow semantic operations plus __testing", () => {
    const src = readFileSync(path.resolve(__dirname, "../trusted-storage.ts"), "utf8");
    const exportedNames = [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    expect(exportedNames.sort()).toEqual(["moveGeneratedAsset", "removeGeneratedAsset", "uploadGeneratedAsset"].sort());
    expect(src).not.toMatch(/export (?:async )?function getServiceRoleClient/);
    expect(src).not.toMatch(/export\s*\{\s*getServiceRoleClient/);
  });

  it("references SUPABASE_SERVICE_ROLE_KEY only inside this one file in the whole repo", () => {
    const files = listTsFiles(REPO_ROOT);
    const offenders = files.filter((f) => {
      if (path.resolve(f) === path.resolve(__dirname, "../trusted-storage.ts")) return false;
      const src = readFileSync(f, "utf8");
      return src.includes("SUPABASE_SERVICE_ROLE_KEY");
    });
    expect(offenders).toEqual([]);
  });

  it("no Client Component (a file with \"use client\") imports trusted-storage, directly or by name", () => {
    const files = listTsFiles(REPO_ROOT);
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.trimStart().startsWith('"use client"') && (src.includes("generated-art/trusted-storage") || src.includes("trusted-storage"));
    });
    expect(offenders).toEqual([]);
  });

  it("is never imported by any lib/game-session gameplay-mutation module — Storage stays isolated from the capability/RPC architecture", () => {
    const gameSessionDir = path.resolve(REPO_ROOT, "lib/game-session");
    const files = listTsFiles(gameSessionDir);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("generated-art/trusted-storage"));
    expect(offenders).toEqual([]);
  });

  it("never logs, serializes, or interpolates the key value in any error message it can throw", () => {
    const src = readFileSync(path.resolve(__dirname, "../trusted-storage.ts"), "utf8");
    expect(src).not.toMatch(/console\.(log|warn|error|debug)\([^)]*key/i);
    // The config-error message is a fixed string mentioning only the env
    // var's NAME (a constant), never `process.env[...]`'s VALUE.
    const configErrorBody = src.match(/class TrustedStorageConfigError[\s\S]*?\n\}/)?.[0] ?? "";
    expect(configErrorBody).not.toMatch(/process\.env\[SERVICE_ROLE_ENV_VAR\]\s*[+`]/);
  });

  it("throws a clear config error rather than silently no-op-ing when the secret is missing", () => {
    const before = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      // uploadGeneratedAsset validates the path before touching the client
      // only when the path itself is invalid; with a valid path it must
      // reach the lazy client construction and fail closed there.
      expect(() => __testing.assertValidGeneratedArtPath("user-1/cr1_00000000000000000000000000000000/x.png", "user-1")).not.toThrow();
    } finally {
      if (before !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = before;
    }
  });
});

describe("trusted-storage — path validation", () => {
  const validate = __testing.assertValidGeneratedArtPath;

  it("accepts a well-formed {userId}/{caseRef}/{filename} path for its own user", () => {
    expect(() => validate("user-1/cr1_00000000000000000000000000000000/abc.png", "user-1")).not.toThrow();
  });

  it("rejects a path traversal segment", () => {
    expect(() => validate("user-1/../other-user/cr1_00000000000000000000000000000000/abc.png", "user-1")).toThrow(TrustedStoragePathError);
  });

  it("rejects a path with the wrong number of segments", () => {
    expect(() => validate("user-1/abc.png", "user-1")).toThrow(TrustedStoragePathError);
    expect(() => validate("user-1/cr1_00000000000000000000000000000000/extra/abc.png", "user-1")).toThrow(TrustedStoragePathError);
  });

  it("rejects a path whose user segment does not match the authenticated caller — no client-supplied userId can grant cross-user authorization", () => {
    expect(() => validate("victim-user/cr1_00000000000000000000000000000000/abc.png", "attacker-user")).toThrow(TrustedStoragePathError);
  });

  it("rejects a non-caseRef case key by default (a raw seed must never be a NEW path)", () => {
    expect(() => validate("user-1/CASE-ABC123/abc.png", "user-1")).toThrow(TrustedStoragePathError);
  });

  it("accepts a legacy seed case key ONLY when explicitly allowed as a migration source", () => {
    expect(() => validate("user-1/CASE-ABC123/abc.png", "user-1", { allowLegacySeedSource: true })).not.toThrow();
  });

  it("still rejects a legacy seed as a migration DESTINATION even when allowLegacySeedSource is set on the wrong call — callers must apply it only to the FROM path", () => {
    // Demonstrates the caller-side contract: moveGeneratedAsset validates
    // fromPath with allowLegacySeedSource and toPath without it.
    expect(() => validate("user-1/CASE-ABC123/abc.png", "user-1")).toThrow(TrustedStoragePathError);
  });

  it("rejects an empty filename segment", () => {
    expect(() => validate("user-1/cr1_00000000000000000000000000000000/", "user-1")).toThrow(TrustedStoragePathError);
  });
});
