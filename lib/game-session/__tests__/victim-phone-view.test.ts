import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getVictimPhoneStatus, getVictimPhoneView } from "../victim-phone-view";
import type { GameSession } from "../types";

function makeSession(seed: string, overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    seed,
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: 0,
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
    ...overrides,
  };
}

const FORBIDDEN_KEYS = [
  "supportsActualMotive",
  "isMotiveClue",
  "isRedHerring",
  "actualMotive",
  "culpritId",
  "hiddenRelationship",
  "templateCategory",
  "crimeRelevance",
  "truthRole",
  "personId",
];

describe("getVictimPhoneStatus", () => {
  it("gates status on the phone device evidence's player status", () => {
    const truth = generateCase("CASE-PHONEVIEW-STATUS", { difficulty: "investigator" });
    const device = truth.evidence.find((e) => e.type === "victim_phone")!;

    expect(getVictimPhoneStatus(truth, makeSession(truth.seed))).toBe("not_found");
    expect(getVictimPhoneStatus(truth, makeSession(truth.seed, { evidenceStatus: { [device.id]: "discovered" } }))).toBe("found");
    expect(getVictimPhoneStatus(truth, makeSession(truth.seed, { evidenceStatus: { [device.id]: "collected" } }))).toBe("found");
    expect(getVictimPhoneStatus(truth, makeSession(truth.seed, { evidenceStatus: { [device.id]: "sent_to_lab" } }))).toBe("extracting");
    expect(getVictimPhoneStatus(truth, makeSession(truth.seed, { evidenceStatus: { [device.id]: "analyzed" } }))).toBe("ready");
  });
});

describe("getVictimPhoneView", () => {
  it("returns no conversations/calls before the phone is analyzed", () => {
    const truth = generateCase("CASE-PHONEVIEW-LOCKED", { difficulty: "investigator" });
    const view = getVictimPhoneView(truth, makeSession(truth.seed));
    expect(view.status).toBe("not_found");
    expect(view.conversations).toEqual([]);
    expect(view.calls).toEqual([]);
  });

  it("returns content once analyzed, with contacts resolved to display names", () => {
    const truth = generateCase("CASE-PHONEVIEW-READY", { difficulty: "investigator" });
    const device = truth.evidence.find((e) => e.type === "victim_phone")!;
    const session = makeSession(truth.seed, { evidenceStatus: { [device.id]: "analyzed" } });
    const view = getVictimPhoneView(truth, session);
    expect(view.status).toBe("ready");
    expect(view.conversations.length + view.calls.length).toBeGreaterThan(0);
    for (const conv of view.conversations) {
      expect(conv.contact.displayName.length).toBeGreaterThan(0);
      expect(conv.messages.length).toBeGreaterThan(0);
    }
  });

  it("conversations are ordered latest-activity-first", () => {
    const truth = generateCase("CASE-PHONEVIEW-ORDER", { difficulty: "investigator" });
    const device = truth.evidence.find((e) => e.type === "victim_phone")!;
    const session = makeSession(truth.seed, { evidenceStatus: { [device.id]: "analyzed" } });
    const view = getVictimPhoneView(truth, session);
    for (let i = 1; i < view.conversations.length; i++) {
      expect(view.conversations[i].lastActivityAt).toBeLessThanOrEqual(view.conversations[i - 1].lastActivityAt);
    }
  });

  it("[K] never leaks a hidden-truth field in the serialized player-facing view", () => {
    for (let i = 0; i < 10; i++) {
      const truth = generateCase(`CASE-PHONEVIEW-LEAK-${i}`, { difficulty: "investigator" });
      const device = truth.evidence.find((e) => e.type === "victim_phone")!;
      const session = makeSession(truth.seed, { evidenceStatus: { [device.id]: "analyzed" } });
      const view = getVictimPhoneView(truth, session);
      const payload = JSON.stringify(view);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(payload).not.toContain(`"${forbidden}"`);
      }
    }
  });

  it("an unmapped contact shows 'Numéro inconnu', never a resolved name", () => {
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-PHONEVIEW-UNKNOWN-${i}`, { difficulty: "investigator" });
      const device = truth.evidence.find((e) => e.type === "victim_phone")!;
      const session = makeSession(truth.seed, { evidenceStatus: { [device.id]: "analyzed" } });
      const view = getVictimPhoneView(truth, session);
      const unknownContacts = [...view.conversations.map((c) => c.contact), ...view.calls.map((c) => c.contact)].filter((c) => !c.isKnownPerson);
      for (const c of unknownContacts) expect(c.displayName).toBe("Numéro inconnu");
    }
  });
});
