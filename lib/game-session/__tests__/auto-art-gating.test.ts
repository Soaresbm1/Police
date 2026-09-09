import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Generated Art V2A — item H: "disabled flags still result in zero
 * generation", tested at the actual production gating point
 * (`startNewCase`'s `after()` registration in `actions.ts`), not just at
 * the flag-getter level (already covered by `auto-portrait-trigger.test.ts`
 * / `auto-scene-trigger.test.ts`). This is the first test in this codebase
 * to exercise a "use server" action directly — `redirect`/`after`/
 * `next/cache` are mocked since none of them have a real request scope in
 * a plain Vitest run; `getCurrentIdentity` is mocked because its
 * dev-fallback branch calls `next/headers#cookies()`, which throws outside
 * a real request. Everything else (`generateCase`, the in-memory
 * `SessionStore`) runs for real — Supabase is never configured in this
 * process's `process.env`, so `getStore()` resolves to the real
 * `MemoryStore`, not a mock.
 */
const { afterCallbacks, runAutoPortraitGenerationMock, runAutoCrimeSceneGenerationMock } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  runAutoPortraitGenerationMock: vi.fn(async () => ({ attempted: 0, cacheHits: 0, ready: 0, failed: 0, skippedDueToCap: 0 })),
  runAutoCrimeSceneGenerationMock: vi.fn(async () => ({ attempted: 0, cacheHits: 0, ready: 0, failed: 0, skipped: 0 })),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: vi.fn((cb: () => Promise<void> | void) => {
    afterCallbacks.push(cb);
  }),
}));
vi.mock("../identity", () => ({
  getCurrentIdentity: vi.fn(async () => ({ userId: "user-1", authenticated: true, displayEmail: null })),
}));
vi.mock("@/lib/art/generation/auto-portrait-trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/art/generation/auto-portrait-trigger")>();
  return { ...actual, runAutoPortraitGeneration: runAutoPortraitGenerationMock };
});
vi.mock("@/lib/art/generation/auto-scene-trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/art/generation/auto-scene-trigger")>();
  return { ...actual, runAutoCrimeSceneGeneration: runAutoCrimeSceneGenerationMock };
});

import { startNewCase } from "../actions";

function makeFormData(): FormData {
  const formData = new FormData();
  formData.set("difficulty", "investigator");
  return formData;
}

describe("startNewCase — automatic art generation gating", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    runAutoPortraitGenerationMock.mockClear();
    runAutoCrimeSceneGenerationMock.mockClear();
    delete process.env.AUTO_GENERATED_PORTRAITS_ENABLED;
    delete process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED;
  });

  it("[H] both flags disabled: after() is never even registered, so zero generation calls can ever happen", async () => {
    await startNewCase(makeFormData());
    expect(afterCallbacks).toHaveLength(0);
    expect(runAutoPortraitGenerationMock).not.toHaveBeenCalled();
    expect(runAutoCrimeSceneGenerationMock).not.toHaveBeenCalled();
  });

  it("portrait flag alone: only portrait generation runs once after() fires; scene stays untouched", async () => {
    process.env.AUTO_GENERATED_PORTRAITS_ENABLED = "true";
    await startNewCase(makeFormData());
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(runAutoPortraitGenerationMock).toHaveBeenCalledTimes(1);
    expect(runAutoCrimeSceneGenerationMock).not.toHaveBeenCalled();
  });

  it("[I] crime-scene flag alone: only scene generation runs; portrait generation stays untouched", async () => {
    process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED = "true";
    await startNewCase(makeFormData());
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(runAutoCrimeSceneGenerationMock).toHaveBeenCalledTimes(1);
    expect(runAutoPortraitGenerationMock).not.toHaveBeenCalled();
  });

  it("[J] both flags on: portrait and scene generation are both invoked from the same after() batch (run concurrently, not one gating the other)", async () => {
    process.env.AUTO_GENERATED_PORTRAITS_ENABLED = "true";
    process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED = "true";
    await startNewCase(makeFormData());
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(runAutoPortraitGenerationMock).toHaveBeenCalledTimes(1);
    expect(runAutoCrimeSceneGenerationMock).toHaveBeenCalledTimes(1);
  });
});
