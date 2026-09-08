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
    };
    this.rows.push(record);
    return record;
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
