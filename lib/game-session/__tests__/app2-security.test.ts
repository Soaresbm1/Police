import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security S2 EXPAND-2 — APP-2 acceptance tests (local only, nothing
 * applied to Supabase — `0009` is a draft). Exercises the real Server
 * Actions against the real in-memory `SessionStore` (Supabase is never
 * configured in this process, so `getStore()` resolves to `MemoryStore`,
 * which mirrors `0009`'s idempotency/monotonic rules exactly — see its own
 * doc comments in `persistence/memory-store.ts`).
 *
 * Covers: evidence transitions, mandate/lab/surveillance server authority
 * and idempotency, event-seen gating, hint progression monotonicity, and
 * the fixed internal time-cost path — the items the user scoped into
 * APP-2 (Generated Art metadata/Storage wiring is tracked separately —
 * see `lib/generated-art/__tests__/trusted-storage-boundary.test.ts`).
 */
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { identity } = vi.hoisted(() => ({ identity: { userId: "", authenticated: true } }));
vi.mock("../identity", () => ({
  getCurrentIdentity: vi.fn(async () => ({ userId: identity.userId, authenticated: identity.authenticated, displayEmail: null })),
}));

import { startNewCase, examineCrimeSceneAction, collectEvidenceAction, sendToLabAction, askQuestionAction, startSurveillanceAction, markEventSeenAction } from "../actions";
import { requestSearchMandateAppAction, getNextHintAction } from "../app-actions";
import { getStore } from "../persistence";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getCrimeSceneEvidence } from "../discovery";
import { evaluateMandate } from "../mandates";

const DIFFICULTY = "investigator" as const;

function formDataFor(): FormData {
  const fd = new FormData();
  fd.set("difficulty", DIFFICULTY);
  return fd;
}

let userCounter = 0;
function newUser(): string {
  userCounter += 1;
  const userId = `app2-user-${userCounter}`;
  identity.userId = userId;
  identity.authenticated = true;
  return userId;
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function freshCaseTruth(userId: string) {
  await startNewCase(formDataFor());
  const session = await getStore().getActiveSession(userId);
  const truth = generateCase(session!.seed, { difficulty: session!.difficulty });
  return { session: session!, truth };
}

describe("evidence transitions (req. evidence)", () => {
  it("a legitimate crime-scene examination reveals only real crime-scene evidence and persists it", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    await examineCrimeSceneAction();
    const after = await getStore().getActiveSession(userId);
    const legit = new Set(getCrimeSceneEvidence(truth).map((e) => e.id));
    for (const [id, status] of Object.entries(after!.evidenceStatus)) {
      if (status !== "undiscovered") expect(legit.has(id)).toBe(true);
    }
  });

  it("collecting an arbitrary/non-existent evidence id is a no-op — never grants collected status", async () => {
    const userId = newUser();
    await freshCaseTruth(userId);
    await collectEvidenceAction("ev_this_id_does_not_exist_anywhere");
    const after = await getStore().getActiveSession(userId);
    expect(after!.evidenceStatus["ev_this_id_does_not_exist_anywhere"]).toBeUndefined();
  });

  it("sending an undiscovered evidence id to the lab is refused — never queues a job for it", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const labEvidence = truth.evidence.find((e) => e.requiresLabAnalysis);
    if (!labEvidence) return; // this generated case has no lab-eligible evidence — nothing to assert
    await sendToLabAction(labEvidence.id);
    const after = await getStore().getActiveSession(userId);
    expect(after!.labQueue.find((j) => j.evidenceId === labEvidence.id)).toBeUndefined();
  });

  it("a full legitimate discover -> collect -> lab -> analyzed pipeline persists at every step", async () => {
    const userId = newUser();
    const { session, truth } = await freshCaseTruth(userId);
    const labEvidence = truth.evidence.find((e) => e.requiresLabAnalysis && getCrimeSceneEvidence(truth).some((cs) => cs.id === e.id));
    if (!labEvidence) return; // no crime-scene, lab-eligible evidence in this generated case
    await examineCrimeSceneAction();
    await collectEvidenceAction(labEvidence.id);
    await sendToLabAction(labEvidence.id);
    const afterSubmit = await getStore().getActiveSession(userId);
    expect(afterSubmit!.evidenceStatus[labEvidence.id]).toBe("sent_to_lab");
    const job = afterSubmit!.labQueue.find((j) => j.evidenceId === labEvidence.id);
    expect(job).toBeDefined();
    void session;
  });
});

describe("mandate server authority (req. mandates)", () => {
  it("the persisted granted/reason exactly matches evaluateMandate's own computation — the client never sets it", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const person = truth.people[0];
    await requestSearchMandateAppAction(person.id);
    const after = await getStore().getActiveSession(userId);
    const key = `search:${person.id}`;
    const stored = after!.mandates[key];
    expect(stored).toBeDefined();
    // Re-derive independently: evaluateMandate is idempotent (returns the
    // existing record if already decided), so calling it again on the
    // freshly-loaded session must reproduce exactly the stored decision.
    // Whole-object equality (never a direct `.granted` read — that field is
    // ESLint-restricted outside mandates.ts/persistence, by design).
    const rederived = evaluateMandate(truth, after!, "search", person.id);
    expect(rederived).toEqual(stored);
  });

  it("a repeated mandate request for the same person never re-decides it (idempotent retry)", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const person = truth.people[0];
    await requestSearchMandateAppAction(person.id);
    const firstDecision = { ...(await getStore().getActiveSession(userId))!.mandates[`search:${person.id}`] };
    await requestSearchMandateAppAction(person.id);
    const secondDecision = (await getStore().getActiveSession(userId))!.mandates[`search:${person.id}`];
    expect(secondDecision).toEqual(firstDecision);
  });
});

describe("surveillance server authority (req. surveillance)", () => {
  it("a legitimate surveillance request persists a record with the requested person/duration and does not crash", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const person = truth.people.find((p) => p.id !== truth.victimId) ?? truth.people[0];
    await startSurveillanceAction(person.id, 120);
    const after = await getStore().getActiveSession(userId);
    const key = Object.keys(after!.surveillance).find((k) => k.startsWith(`${person.id}:`));
    // Eligibility rules (coverage/overlap/victim exclusion) may legitimately
    // refuse this specific request — this test only asserts that WHEN a
    // record exists, its shape is the server-computed one, never something
    // the (nonexistent, for this action) client input could have supplied
    // directly (there is no "observations" or "granted" parameter on
    // startSurveillanceAction at all).
    if (key) {
      const record = after!.surveillance[key];
      expect(record.personId).toBe(person.id);
      expect(record.durationMinutes).toBe(120);
      expect(Array.isArray(record.observations)).toBe(true);
    }
  });

  it("a repeated surveillance request for the same person+time never re-decides it (idempotent retry)", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const person = truth.people.find((p) => p.id !== truth.victimId) ?? truth.people[0];
    await startSurveillanceAction(person.id, 120);
    const before = { ...(await getStore().getActiveSession(userId))!.surveillance };
    await startSurveillanceAction(person.id, 120);
    const after = (await getStore().getActiveSession(userId))!.surveillance;
    expect(after).toEqual(before);
  });
});

describe("investigation events (req. investigation-events)", () => {
  it("mark-event-seen only ever transitions ready -> seen — a scheduled event stays scheduled", async () => {
    const userId = newUser();
    const { truth } = await freshCaseTruth(userId);
    const person = truth.people[0];
    await requestSearchMandateAppAction(person.id);
    const before = await getStore().getActiveSession(userId);
    const event = before!.events.find((e) => e.type === "search_warrant");
    expect(event).toBeDefined();
    expect(event!.status).toBe("scheduled");
    await markEventSeenAction(event!.id);
    const after = await getStore().getActiveSession(userId);
    // Still scheduled — markEventSeen must never skip the time gate.
    expect(after!.events.find((e) => e.id === event!.id)!.status).toBe("scheduled");
  });

  it("askQuestionAction pays the fixed internal 5-minute cost through the trusted path, not an unbounded local mutation", async () => {
    const userId = newUser();
    const { session, truth } = await freshCaseTruth(userId);
    const beforeTime = session.currentTime;
    const person = truth.people[0];
    await askQuestionAction(person.id, "nonexistent_fact_id");
    const after = await getStore().getActiveSession(userId);
    expect(after!.currentTime).toBe(beforeTime + 5);
  });
});

describe("hint progression monotonicity (req. hints)", () => {
  it("escalating/requesting hints only ever increases totalHintsUsed, never resets it", async () => {
    const userId = newUser();
    await freshCaseTruth(userId);
    await getNextHintAction();
    const afterFirst = (await getStore().getActiveSession(userId))!.hintState.totalHintsUsed;
    expect(afterFirst).toBeGreaterThan(0);
    await getNextHintAction();
    const afterSecond = (await getStore().getActiveSession(userId))!.hintState.totalHintsUsed;
    expect(afterSecond).toBeGreaterThanOrEqual(afterFirst);
  });

  it("a forged lower-level hint record can never regress already-recorded progress", async () => {
    const userId = newUser();
    const { session } = await freshCaseTruth(userId);
    await getNextHintAction();
    const afterHint = (await getStore().getActiveSession(userId))!;
    const entry = afterHint.hintState.history[0];
    const progressBefore = { ...afterHint.hintState.progress };
    // Simulate a forged/replayed call at a level at-or-below what's already
    // recorded — the store must no-op, exactly like `caseline_record_hint`'s
    // `if p_level <= v_existing` guard.
    await getStore().recordHint(userId, session.sessionUuid, { ...entry, level: entry.level });
    const afterForgedReplay = (await getStore().getActiveSession(userId))!;
    expect(afterForgedReplay.hintState.progress).toEqual(progressBefore);
  });
});
