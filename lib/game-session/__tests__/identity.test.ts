import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

describe("getCurrentIdentity", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
    getUser.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    vi.resetModules();
  });

  it("degrades to unauthenticated, rather than throwing, when auth.getUser() rejects (a transient network failure)", async () => {
    getUser.mockRejectedValue(new Error("fetch failed"));
    const { getCurrentIdentity } = await import("../identity");

    await expect(getCurrentIdentity()).resolves.toEqual({ userId: "", authenticated: false, displayEmail: null });
  });

  it("still resolves the signed-in user on the normal success path", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.test" } } });
    const { getCurrentIdentity } = await import("../identity");

    await expect(getCurrentIdentity()).resolves.toEqual({ userId: "user-1", authenticated: true, displayEmail: "a@b.test" });
  });
});
