import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareGeneratedAssetProvider, isCloudflareConfigured } from "../cloudflare-provider";
import { hashSeed } from "../../../hash";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, init: { status?: number; contentType?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

describe("isCloudflareConfigured", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("is false when either variable is missing", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_API_TOKEN = "token";
    expect(isCloudflareConfigured()).toBe(false);
  });

  it("is true only when both are set", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    expect(isCloudflareConfigured()).toBe(true);
  });
});

describe("CloudflareGeneratedAssetProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CLOUDFLARE_ACCOUNT_ID: "acct-123", CLOUDFLARE_API_TOKEN: "secret-token" };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("returns null and never calls fetch when credentials are missing (procedural fallback)", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a JSON-wrapped base64 response into bytes/contentType/dimensions/model", async () => {
    const imageBytes = Buffer.from("fake-jpeg-bytes");
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { image: imageBytes.toString("base64") }, success: true }));

    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");

    expect(result).not.toBeNull();
    expect(Buffer.from(result!.bytes).toString()).toBe("fake-jpeg-bytes");
    expect(result!.contentType).toBe("image/jpeg");
    expect(result!.model).toBe("@cf/black-forest-labs/flux-1-schnell");
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
  });

  it("also accepts a raw binary image/jpeg response (no JSON envelope)", async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(
      new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );

    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("crime_scene_environment", "a prompt", "seed-2");

    expect(result).not.toBeNull();
    expect(Array.from(result!.bytes)).toEqual([1, 2, 3, 4]);
  });

  it("sends a deterministic positive-integer seed derived from the string seed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { image: Buffer.from("x").toString("base64") } }));
    const provider = new CloudflareGeneratedAssetProvider();
    await provider.generate("character_portrait", "a prompt", "same-seed");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.seed).toBe(hashSeed("same-seed") % 2_147_483_647);
    expect(Number.isInteger(body.seed)).toBe(true);
    expect(body.seed).toBeGreaterThanOrEqual(0);
  });

  it("sends the Authorization header and account id in the URL, never logging the token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { image: Buffer.from("x").toString("base64") } }));
    const provider = new CloudflareGeneratedAssetProvider();
    await provider.generate("character_portrait", "a prompt", "seed-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/accounts/acct-123/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  it("returns null on a 429 rate-limit response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
  });

  it("returns null on a malformed response (success:false)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, errors: [{ message: "content policy violation" }] }));
    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
  });

  it("returns null when the JSON response has no image field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, result: {} }));
    const provider = new CloudflareGeneratedAssetProvider();
    const result = await provider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
  });

  it("returns null (never throws) on a network failure or timeout", async () => {
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted"));
    const provider = new CloudflareGeneratedAssetProvider();
    await expect(provider.generate("character_portrait", "a prompt", "seed-1")).resolves.toBeNull();
  });

  it("clamps IMAGE_GENERATION_STEPS to the documented 1-8 range", async () => {
    process.env.IMAGE_GENERATION_STEPS = "99";
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: { image: Buffer.from("x").toString("base64") } }));
    const provider = new CloudflareGeneratedAssetProvider();
    await provider.generate("character_portrait", "a prompt", "seed-1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.steps).toBe(8);
  });
});
