import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security S2 — APP-1 acceptance tests. Exercises the real Server Actions
 * (`../actions`) against the real in-memory `SessionStore` (Supabase is
 * never configured in this process, so `getStore()` resolves to
 * `MemoryStore` — same convention as `auto-art-gating.test.ts` and
 * `reconstruction-release.test.ts`). `redirect`/`revalidatePath` are mocked
 * since neither has a real request scope in a plain Vitest run.
 *
 * Covers the APP-1 checklist: session_uuid lifecycle, time-advance
 * allow-list enforcement, profile-preferences scoping, and
 * accusation/finalization idempotency — the five items the user explicitly
 * scoped into APP-1 (evidence/mandates/lab/surveillance/hints are EXPAND-2).
 */
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { identity } = vi.hoisted(() => ({ identity: { userId: "", authenticated: true } }));
vi.mock("../identity", () => ({
  getCurrentIdentity: vi.fn(async () => ({ userId: identity.userId, authenticated: identity.authenticated, displayEmail: null })),
}));

import { redirect } from "next/navigation";
import { startNewCase, advanceTimeAction, submitAccusationAction } from "../actions";
import { getStore } from "../persistence";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

const DIFFICULTY = "investigator" as const;

function formDataFor(difficulty = DIFFICULTY): FormData {
  const fd = new FormData();
  fd.set("difficulty", difficulty);
  return fd;
}

let userCounter = 0;
function newUser(): string {
  userCounter += 1;
  const userId = `app1-user-${userCounter}`;
  identity.userId = userId;
  identity.authenticated = true;
  return userId;
}

beforeEach(() => {
  vi.mocked(redirect).mockClear();
});

describe("session_uuid lifecycle (req. A)", () => {
  it("assigns a fresh session_uuid when a new case is created", async () => {
    const userId = newUser();
    await startNewCase(formDataFor());
    const session = await getStore().getActiveSession(userId);
    expect(session?.sessionUuid).toBeTruthy();
  });

  it("keeps session_uuid stable across an ordinary save (no case change)", async () => {
    const userId = newUser();
    await startNewCase(formDataFor());
    const before = await getStore().getActiveSession(userId);
    await getStore().saveSession(userId, { ...before!, notes: "updated notes" });
    const after = await getStore().getActiveSession(userId);
    expect(after?.sessionUuid).toBe(before?.sessionUuid);
  });

  it("assigns a different session_uuid to a new case than the previous one", async () => {
    const userId = newUser();
    await startNewCase(formDataFor());
    const first = await getStore().getActiveSession(userId);
    await startNewCase(formDataFor());
    const second = await getStore().getActiveSession(userId);
    expect(second?.sessionUuid).not.toBe(first?.sessionUuid);
  });
});

describe("time advance allow-list (req. B)", () => {
  it.each([30, 60, 240] as const)("advances the clock by an allowed delta (%i minutes)", async (minutes) => {
    const userId = newUser();
    await startNewCase(formDataFor());
    // Snapshot the primitive, not the session object: MemoryStore hands back
    // the same object reference on every read, so holding onto `before` and
    // reading its `.currentTime` again after the action would just read the
    // already-mutated value.
    const beforeTime = (await getStore().getActiveSession(userId))!.currentTime;
    await advanceTimeAction(minutes);
    const after = await getStore().getActiveSession(userId);
    expect(after!.currentTime).toBe(beforeTime + minutes);
  });

  it.each([1, 15, 45, 90, 1440, -30, 0])("silently ignores a disallowed delta (%i minutes) — no time passes", async (minutes) => {
    const userId = newUser();
    await startNewCase(formDataFor());
    const beforeTime = (await getStore().getActiveSession(userId))!.currentTime;
    await advanceTimeAction(minutes);
    const after = await getStore().getActiveSession(userId);
    expect(after!.currentTime).toBe(beforeTime);
  });

  it("never calls the store's authoritative advanceTime for a disallowed delta", async () => {
    newUser();
    await startNewCase(formDataFor());
    const store = getStore();
    const spy = vi.spyOn(store, "advanceTime");
    await advanceTimeAction(999);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("profile preferences scoping (req. C)", () => {
  it("updateSettings only ever touches the three declared PlayerSettings fields, even if extra keys are injected", async () => {
    const userId = newUser();
    // Snapshot primitives, not the profile object: MemoryStore hands back
    // the same object reference on every read, so comparing `after` to a
    // held-onto `before` reference would trivially pass even if
    // `updateSettings` mutated xp/rank in place.
    const xpBefore = (await getStore().getProfile(userId)).xp;
    const rankBefore = (await getStore().getProfile(userId)).rank;
    const maliciousPatch = { soundMuted: true } as Record<string, unknown>;
    // Simulate a caller that (like a tampered direct RPC call) tries to also
    // smuggle authoritative fields through the same patch object.
    (maliciousPatch as { xp?: number }).xp = 999999;
    (maliciousPatch as { rank?: string }).rank = "Commissaire";
    const after = await getStore().updateSettings(userId, maliciousPatch as never);
    expect(after.xp).toBe(xpBefore);
    expect(after.rank).toBe(rankBefore);
    expect(after.settings.soundMuted).toBe(true);
  });
});

describe("accusation / finalization (req. D + E)", () => {
  async function playToAccusation(userId: string) {
    await startNewCase(formDataFor());
    const session = await getStore().getActiveSession(userId);
    const truth = generateCase(session!.seed, { difficulty: session!.difficulty });
    const fd = new FormData();
    fd.set("culpritId", truth.culpritId);
    fd.set("motiveType", truth.motive.type);
    fd.set("method", truth.weapon);
    return fd;
  }

  it("computes score/xp server-side — the client cannot supply an authoritative result", async () => {
    const userId = newUser();
    const fd = await playToAccusation(userId);
    // A tampered form cannot express a score or xp field at all: only
    // culpritId/motiveType/method/accompliceId(s)/accompliceRole(s) are ever
    // read by submitAccusationAction (see ../actions.ts). Prove a forged
    // "score"/"xpGained" field submitted alongside the real ones is inert.
    fd.set("score", JSON.stringify({ grade: "S" }));
    fd.set("xpGained", "999999");
    await submitAccusationAction(fd);
    const profile = await getStore().getProfile(userId);
    // A correct culprit/motive/method guess is graded S (150 xp) by
    // career.ts#XP_BY_GRADE — never the forged 999999.
    expect(profile.xp).toBeLessThan(999999);
  });

  it("finalizes exactly once and archives exactly one case_history row on a genuine single submit", async () => {
    const userId = newUser();
    const fd = await playToAccusation(userId);
    await submitAccusationAction(fd);
    const history = await getStore().listCaseHistory(userId);
    expect(history).toHaveLength(1);
  });

  it("a retried submit for the same session is idempotent — no double XP, no second history row", async () => {
    const userId = newUser();
    const fd = await playToAccusation(userId);
    await submitAccusationAction(fd);
    // Snapshot primitives, not the profile/history objects: MemoryStore
    // hands back the same object/array reference on every read, so holding
    // onto the object itself and comparing it to a later read of the SAME
    // object would trivially pass regardless of whether a double-write
    // actually happened.
    const xpAfterFirst = (await getStore().getProfile(userId)).xp;
    const accusationsAfterFirst = (await getStore().getProfile(userId)).accusationsTotal;
    const historyLengthAfterFirst = (await getStore().listCaseHistory(userId)).length;

    // Re-submit the identical accusation against the same active session
    // (the session is still active — endCurrentCase/startNewCase weren't
    // called — mirroring a client retry after a dropped response).
    await submitAccusationAction(fd);
    const profileAfterRetry = await getStore().getProfile(userId);
    const historyAfterRetry = await getStore().listCaseHistory(userId);

    expect(profileAfterRetry.xp).toBe(xpAfterFirst);
    expect(profileAfterRetry.accusationsTotal).toBe(accusationsAfterFirst);
    expect(historyAfterRetry.length).toBe(historyLengthAfterFirst);
  });

  it("awards exactly one rank-affecting XP grant per finalized case", async () => {
    const userId = newUser();
    const xpBefore = (await getStore().getProfile(userId)).xp;
    const casesBefore = (await getStore().getProfile(userId)).casesSolved + (await getStore().getProfile(userId)).casesFailed;
    const fd = await playToAccusation(userId);
    await submitAccusationAction(fd);
    const after = await getStore().getProfile(userId);
    expect(after.xp).toBeGreaterThan(xpBefore);
    expect(after.casesSolved + after.casesFailed).toBe(casesBefore + 1);
  });

  it("redirects to the report page after finalizing", async () => {
    const userId = newUser();
    const fd = await playToAccusation(userId);
    await submitAccusationAction(fd);
    expect(redirect).toHaveBeenCalledWith("/investigation/rapport");
  });
});
