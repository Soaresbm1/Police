import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrGenerateAsset, type AssetStoreLike } from "../pipeline";
import { MockGeneratedAssetProvider, AlwaysMissingGeneratedAssetProvider } from "../mock-provider";
import { CloudflareGeneratedAssetProvider } from "../providers/cloudflare-provider";
import type { GeneratedAssetKind, GeneratedAssetRecord } from "../types";
import { MAX_ASSETS_PER_CASE, MAX_GENERATION_ATTEMPTS } from "../limits";

/** In-memory stand-in for `asset-store.ts` — same contract, no Supabase. */
class FakeAssetStore implements AssetStoreLike {
  rows: GeneratedAssetRecord[] = [];
  private nextId = 1;
  uploadCalls = 0;

  async findAssetRecord(userId: string, descriptorHash: string, generationVersion: number, provider: string) {
    return (
      this.rows.find(
        (r) => r.userId === userId && r.descriptorHash === descriptorHash && r.generationVersion === generationVersion && r.provider === provider,
      ) ?? null
    );
  }

  async createQueuedRecord(
    userId: string,
    caseSeed: string,
    assetKind: GeneratedAssetKind,
    descriptorHash: string,
    generationVersion: number,
    provider: string,
    reuseKey: string | null,
  ) {
    const record: GeneratedAssetRecord = {
      id: String(this.nextId++),
      userId,
      caseSeed,
      assetKind,
      descriptorHash,
      generationVersion,
      provider,
      providerModel: null,
      status: "queued",
      storagePath: null,
      width: null,
      height: null,
      promptVersion: null,
      errorMessage: null,
      attemptCount: 0,
      failedAt: null,
      reuseKey,
      reuseCount: 0,
      sourceAssetId: null, // a freshly-generated row is always canonical
    };
    this.rows.push(record);
    return record;
  }

  async findReusableAssetCandidates(
    userId: string,
    assetKind: GeneratedAssetKind,
    generationVersion: number,
    provider: string,
    reuseKey: string,
    excludeCaseSeed: string,
    limit: number,
  ) {
    return this.rows
      .filter(
        (r) =>
          r.userId === userId &&
          r.assetKind === assetKind &&
          r.generationVersion === generationVersion &&
          r.provider === provider &&
          r.reuseKey === reuseKey &&
          r.status === "ready" &&
          r.sourceAssetId === null && // canonical sources only — never a reused row
          r.caseSeed !== excludeCaseSeed,
      )
      .sort((a, b) => a.reuseCount - b.reuseCount || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async createReusedRecord(
    userId: string,
    caseSeed: string,
    assetKind: GeneratedAssetKind,
    descriptorHash: string,
    generationVersion: number,
    provider: string,
    source: GeneratedAssetRecord,
    reuseKey: string,
    canonicalSourceId: string,
  ) {
    const record: GeneratedAssetRecord = {
      id: String(this.nextId++),
      userId,
      caseSeed,
      assetKind,
      descriptorHash,
      generationVersion,
      provider,
      providerModel: source.providerModel,
      status: "ready",
      storagePath: source.storagePath,
      width: source.width,
      height: source.height,
      promptVersion: source.promptVersion,
      errorMessage: null,
      attemptCount: 0,
      failedAt: null,
      reuseKey,
      reuseCount: 0,
      sourceAssetId: canonicalSourceId,
    };
    this.rows.push(record);
    return record;
  }

  async incrementReuseCount(userId: string, assetId: string) {
    const r = this.rows.find((x) => x.id === assetId && x.userId === userId);
    if (r) r.reuseCount++;
  }

  async markGenerating(userId: string, id: string) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) r.status = "generating";
  }

  async markReady(userId: string, id: string, fields: { storagePath: string; width: number; height: number; providerModel: string; promptVersion: number }) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) Object.assign(r, { status: "ready", ...fields });
  }

  async markFailed(userId: string, id: string, errorMessage: string, attemptCount: number) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) Object.assign(r, { status: "failed", errorMessage, attemptCount, failedAt: new Date().toISOString() });
  }

  async countAssetsForCase(userId: string, caseSeed: string) {
    return this.rows.filter((r) => r.userId === userId && r.caseSeed === caseSeed).length;
  }

  async uploadAssetBytes(userId: string, caseSeed: string, descriptorHash: string) {
    this.uploadCalls++;
    return { path: `${userId}/${caseSeed}/${descriptorHash}.svg` };
  }

  async getSignedAssetUrl(path: string) {
    return `https://example.test/signed/${path}`;
  }
}

const baseArgs = {
  userId: "user-1",
  caseSeed: "CASE-A",
  assetKind: "character_portrait" as GeneratedAssetKind,
  descriptorHash: "hash-1",
  generationVersion: 1,
  providerName: "mock",
  promptVersion: 1,
  prompt: "a prompt",
  seed: "seed-1",
};

describe("getOrGenerateAsset", () => {
  it("generates once and reuses the ready record on a second call (no duplicate generation)", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    const first = await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(first.status).toBe("ready");
    expect(first.url).toMatch(/^https:\/\/example\.test\/signed\//);

    const second = await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(second.status).toBe("ready");
    expect(provider.calls).toHaveLength(1); // never called twice for the same descriptor
    expect(store.uploadCalls).toBe(1);
  });

  it("reuses a pre-seeded ready record without generating (simulates a server restart)", async () => {
    const store = new FakeAssetStore();
    await store.createQueuedRecord(
      baseArgs.userId,
      baseArgs.caseSeed,
      baseArgs.assetKind,
      baseArgs.descriptorHash,
      baseArgs.generationVersion,
      baseArgs.providerName,
      null,
    );
    const record = store.rows[0];
    await store.markReady(baseArgs.userId, record.id, { storagePath: "existing/path.svg", width: 8, height: 8, providerModel: "old-model", promptVersion: 1 });

    const provider = new MockGeneratedAssetProvider();
    const result = await getOrGenerateAsset({ store, provider }, baseArgs);

    expect(result.status).toBe("ready");
    expect(provider.calls).toHaveLength(0); // cache hit, provider never touched
  });

  it("falls back cleanly when the provider is unavailable — never throws", async () => {
    const store = new FakeAssetStore();
    const provider = new AlwaysMissingGeneratedAssetProvider();

    const result = await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(result.status).toBe("failed");
    expect(result.url).toBeNull();
    expect(store.rows[0].status).toBe("failed");
    expect(store.rows[0].attemptCount).toBe(1);
  });

  it("treats a different generationVersion as a cache miss without disturbing the old row", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, baseArgs);
    const v2 = await getOrGenerateAsset({ store, provider }, { ...baseArgs, generationVersion: 2 });

    expect(v2.status).toBe("ready");
    expect(provider.calls).toHaveLength(2);
    expect(store.rows).toHaveLength(2);
    expect(store.rows.find((r) => r.generationVersion === 1)?.status).toBe("ready");
  });

  it("blocks an immediate retry after a failure (cooldown), without touching attemptCount again", async () => {
    const store = new FakeAssetStore();
    const provider = new AlwaysMissingGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(store.rows[0].attemptCount).toBe(1);

    const generateSpy = vi.spyOn(provider, "generate");
    const result = await getOrGenerateAsset({ store, provider }, baseArgs); // still within cooldown
    expect(result.status).toBe("failed");
    expect(generateSpy).not.toHaveBeenCalled();
    expect(store.rows[0].attemptCount).toBe(1); // unchanged — the retry never reached the provider
  });

  it("stops retrying once MAX_GENERATION_ATTEMPTS is reached, even after the cooldown has passed", async () => {
    const store = new FakeAssetStore();
    const provider = new AlwaysMissingGeneratedAssetProvider();

    await store.createQueuedRecord(
      baseArgs.userId,
      baseArgs.caseSeed,
      baseArgs.assetKind,
      baseArgs.descriptorHash,
      baseArgs.generationVersion,
      baseArgs.providerName,
      null,
    );
    // Simulate MAX_GENERATION_ATTEMPTS prior failures, all safely outside
    // the cooldown window (an hour ago), so only the attempt cap is being
    // exercised here — the cooldown test above covers the other limit.
    Object.assign(store.rows[0], {
      status: "failed",
      attemptCount: MAX_GENERATION_ATTEMPTS,
      failedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const generateSpy = vi.spyOn(provider, "generate");
    const result = await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(result.status).toBe("failed");
    expect(generateSpy).not.toHaveBeenCalled(); // attempts exhausted, no further calls
  });

  it("never generates beyond MAX_ASSETS_PER_CASE for one case", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    for (let i = 0; i < MAX_ASSETS_PER_CASE; i++) {
      const result = await getOrGenerateAsset({ store, provider }, { ...baseArgs, descriptorHash: `hash-${i}` });
      expect(result.status).toBe("ready");
    }
    const overCap = await getOrGenerateAsset({ store, provider }, { ...baseArgs, descriptorHash: "one-too-many" });
    expect(overCap.status).toBe("missing");
    expect(provider.calls).toHaveLength(MAX_ASSETS_PER_CASE);
  });

  it("full lifecycle: missing -> queued -> generating -> ready", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    expect(await store.findAssetRecord(baseArgs.userId, baseArgs.descriptorHash, 1, "mock")).toBeNull(); // missing

    const result = await getOrGenerateAsset({ store, provider }, baseArgs);
    expect(result.status).toBe("ready");
    expect(store.rows[0].status).toBe("ready");
    expect(store.rows[0].storagePath).toContain(baseArgs.descriptorHash);
  });

  it("never lets user B's lookup see user A's asset, even for the identical descriptor", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, userId: "user-A" });
    const resultB = await getOrGenerateAsset({ store, provider }, { ...baseArgs, userId: "user-B" });

    expect(resultB.status).toBe("ready"); // user B still gets served — just via their OWN new row
    expect(provider.calls).toHaveLength(2); // never reused across users
    expect(store.rows.filter((r) => r.userId === "user-A")).toHaveLength(1);
    expect(store.rows.filter((r) => r.userId === "user-B")).toHaveLength(1);
    expect(await store.findAssetRecord("user-B", baseArgs.descriptorHash, baseArgs.generationVersion, baseArgs.providerName)).not.toBeNull();
    // user-B's row is never user-A's row, and vice versa.
    const rowA = await store.findAssetRecord("user-A", baseArgs.descriptorHash, baseArgs.generationVersion, baseArgs.providerName);
    const rowB = await store.findAssetRecord("user-B", baseArgs.descriptorHash, baseArgs.generationVersion, baseArgs.providerName);
    expect(rowA!.id).not.toBe(rowB!.id);
  });

  describe("with the real Cloudflare provider (mocked HTTP — never a real network call)", () => {
    const ORIGINAL_ENV = { ...process.env };
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV, CLOUDFLARE_ACCOUNT_ID: "acct-123", CLOUDFLARE_API_TOKEN: "secret-token" };
      fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: { image: Buffer.from("fake").toString("base64") }, success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
      vi.unstubAllGlobals();
    });

    it("a second call for the same descriptor never calls Cloudflare again (cache hit = zero calls)", async () => {
      const store = new FakeAssetStore();
      const provider = new CloudflareGeneratedAssetProvider();
      const args = { ...baseArgs, providerName: "cloudflare" };

      await getOrGenerateAsset({ store, provider }, args);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await getOrGenerateAsset({ store, provider }, args); // simulates a page refresh / navigation / resumed case
      expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — no duplicate spend
    });
  });
});

describe("getOrGenerateAsset — same-user reuse (Generated Art V2B)", () => {
  function reuseLookupFor(excludeCaseSeed: string, claimedSourceIds: Set<string> = new Set()) {
    return { excludeCaseSeed, claimedSourceIds, candidateLimit: 8 };
  }

  it("[C] a compatible reusable asset from a DIFFERENT case is used with zero provider calls", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    // First entity, first case — a real generation, tagged with a reuse key.
    const first = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-entity-1", reuseKey: "bucket-1" },
    );
    expect(first.origin).toBe("fresh_generation");
    expect(provider.calls).toHaveLength(1);

    // Second entity, a DIFFERENT case, same reuse bucket, no exact-hash row of its own yet.
    const second = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-entity-2", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );

    expect(second.status).toBe("ready");
    expect(second.origin).toBe("reuse");
    expect(provider.calls).toHaveLength(1); // zero NEW provider calls
  });

  it("[A] an exact-cache hit always wins over a reusable hit, even when both would match", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    // This entity already has its OWN exact-hash ready row (simulates a
    // refresh/navigation) — a reusable candidate also exists and would
    // match, but must never be consulted.
    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    provider.calls.length = 0;

    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    expect(result.origin).toBe("exact_cache");
    expect(provider.calls).toHaveLength(0);
  });

  it("[D] an incompatible reuse bucket falls through to a real provider generation", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });

    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-2" }, // different bucket
      reuseLookupFor("CASE-B"),
    );
    expect(result.origin).toBe("fresh_generation");
    expect(provider.calls).toHaveLength(2);
  });

  it("[G] a compatible asset from the SAME case is excluded from reuse — falls through to real generation", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-1", reuseKey: "bucket-1" });

    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-2", reuseKey: "bucket-1" }, // same case!
      reuseLookupFor("CASE-A"),
    );
    expect(result.origin).toBe("fresh_generation");
    expect(provider.calls).toHaveLength(2); // never reused within the same case
  });

  it("[H] a source already claimed by a concurrent sibling (same batch) is never picked twice — falls through to generation", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    const sourceId = store.rows[0].id;

    const claimedSourceIds = new Set<string>([sourceId]); // simulates a sibling worker having already claimed it
    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B", claimedSourceIds),
    );
    expect(result.origin).toBe("fresh_generation"); // the only candidate was already claimed
  });

  it("[J, K] a reusable asset is never found across users, even for an identical reuse key", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, userId: "user-A", caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" },
    );

    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, userId: "user-B", caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    expect(result.origin).toBe("fresh_generation"); // user-A's asset is invisible to user-B
    expect(provider.calls).toHaveLength(2);
  });

  it("[L, M, N] a reused row gets the CURRENT entity's exact descriptor_hash and case_seed, and points at the source's own storagePath", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    const sourceRow = store.rows[0];

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );

    const reusedRow = store.rows.find((r) => r.descriptorHash === "hash-target")!;
    expect(reusedRow.caseSeed).toBe("CASE-B");
    expect(reusedRow.descriptorHash).toBe("hash-target");
    expect(reusedRow.storagePath).toBe(sourceRow.storagePath);
    expect(reusedRow.status).toBe("ready");
  });

  it("[E, O] reuse_count increments only on the canonical source row, every time it's reused — a reused row is never itself a candidate, so it can never accumulate its own count", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    const sourceId = store.rows[0].id;
    expect(store.rows[0].reuseCount).toBe(0);

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target-1", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    expect(store.rows.find((r) => r.id === sourceId)!.reuseCount).toBe(1);
    const firstReusedRow = store.rows.find((r) => r.descriptorHash === "hash-target-1")!;
    expect(firstReusedRow.reuseCount).toBe(0); // a reused row never accumulates its own count

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-C", descriptorHash: "hash-target-2", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-C"),
    );
    // "hash-target-1" is now permanently excluded from the candidate pool
    // (source_asset_id IS NOT NULL) — the ONLY canonical row is still
    // "hash-source", which must be the one incremented again.
    expect(store.rows.find((r) => r.id === sourceId)!.reuseCount).toBe(2);
    expect(firstReusedRow.reuseCount).toBe(0);
  });

  it("[P, Q] after a reuse hit, this entity's OWN exact cache now works too — a later call is a plain cache hit, zero provider calls", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    provider.calls.length = 0;

    // Simulates a refresh/navigation/restart for the SAME entity in CASE-B.
    const again = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    expect(again.origin).toBe("exact_cache");
    expect(provider.calls).toHaveLength(0);
  });

  it("[A] a freshly-generated asset always has sourceAssetId = null (it IS a canonical source)", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    expect(store.rows[0].sourceAssetId).toBeNull();
  });

  it("[B] a reused asset's sourceAssetId always points at the canonical source's own id", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    const canonicalId = store.rows[0].id;

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    const reusedRow = store.rows.find((r) => r.descriptorHash === "hash-target")!;
    expect(reusedRow.sourceAssetId).toBe(canonicalId);
  });

  it("[C] a reused row is never itself returned as a reuse candidate", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-source", reuseKey: "bucket-1" });
    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target-1", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    const reusedRow = store.rows.find((r) => r.descriptorHash === "hash-target-1")!;
    expect(reusedRow.sourceAssetId).not.toBeNull();

    // Excluding only CASE-A (the canonical source's own case) — CASE-B
    // (the reused row's case) is NOT excluded here, isolating the
    // question to exactly "is the reused row itself eligible", not
    // "is it excluded because it's in the requester's own case".
    const candidates = await store.findReusableAssetCandidates(
      "user-1",
      "character_portrait",
      1,
      "mock",
      "bucket-1",
      "CASE-A",
      8,
    );
    expect(candidates.map((c) => c.id)).not.toContain(reusedRow.id);
  });

  it("[D] a reuse chain (A -> B -> C) cannot occur — C always resolves directly to A, never to B", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-A", reuseKey: "bucket-1" });
    const rowA = store.rows.find((r) => r.descriptorHash === "hash-A")!;

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-B", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    const rowB = store.rows.find((r) => r.descriptorHash === "hash-B")!;
    expect(rowB.sourceAssetId).toBe(rowA.id); // B -> A directly

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-C", descriptorHash: "hash-C", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-C"),
    );
    const rowC = store.rows.find((r) => r.descriptorHash === "hash-C")!;
    // C must resolve to the CANONICAL source A — never to B, which would
    // be a chain (A -> B -> C).
    expect(rowC.sourceAssetId).toBe(rowA.id);
    expect(rowC.sourceAssetId).not.toBe(rowB.id);
    expect(rowC.storagePath).toBe(rowA.storagePath);
  });

  it("[H] a reused row's own case_seed is the REQUESTING case, never inherited from the canonical source — so same-case exclusion correctly covers it too, even though it shares storage_path with an external canonical row", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-A", reuseKey: "bucket-1" });
    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-B", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    const rowB = store.rows.find((r) => r.descriptorHash === "hash-B")!;
    expect(rowB.caseSeed).toBe("CASE-B"); // not "CASE-A" — tagged with the requester's own case

    // A same-case lookup (excluding CASE-B) must never surface rowB —
    // doubly excluded (it's non-canonical AND same-case), even though its
    // physical storage_path is shared with the canonical hash-A row.
    const candidates = await store.findReusableAssetCandidates("user-1", "character_portrait", 1, "mock", "bucket-1", "CASE-B", 8);
    expect(candidates.map((c) => c.id)).not.toContain(rowB.id);
  });

  it("[F] prefers the least-reused compatible candidate (reuse_count ASC ordering, comparing canonical sources only)", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-A", descriptorHash: "hash-popular", reuseKey: "bucket-1" });
    await getOrGenerateAsset({ store, provider }, { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-fresh", reuseKey: "bucket-1" });
    const popularId = store.rows.find((r) => r.descriptorHash === "hash-popular")!.id;
    await store.incrementReuseCount("user-1", popularId); // "hash-popular" already reused once elsewhere

    await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-C", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-C"),
    );
    const reusedRow = store.rows.find((r) => r.descriptorHash === "hash-target")!;
    const freshSourceRow = store.rows.find((r) => r.descriptorHash === "hash-fresh")!;
    expect(reusedRow.storagePath).toBe(freshSourceRow.storagePath); // picked the less-reused one, not "hash-popular"
  });

  it("degrades to a real generation (never throws) when the reuse lookup itself fails", async () => {
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();
    vi.spyOn(store, "findReusableAssetCandidates").mockRejectedValueOnce(new Error("Supabase outage"));

    const result = await getOrGenerateAsset(
      { store, provider },
      { ...baseArgs, caseSeed: "CASE-B", descriptorHash: "hash-target", reuseKey: "bucket-1" },
      reuseLookupFor("CASE-B"),
    );
    expect(result.status).toBe("ready");
    expect(result.origin).toBe("fresh_generation");
  });
});
