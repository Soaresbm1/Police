import { describe, expect, it } from "vitest";
import { generateCase } from "../case-truth";

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
];

describe("victim phone generation", () => {
  it("[A] the victim has deterministic phone data for a fresh case", () => {
    const truth = generateCase("CASE-PHONE-A", { difficulty: "investigator" });
    expect(truth.victimPhone).toBeDefined();
    expect(truth.victimPhone.ownerPersonId).toBe(truth.victimId);
    expect(truth.victimPhone.contacts.length).toBeGreaterThan(0);
  });

  it("[B] the same seed produces byte-identical phone data", () => {
    const a = generateCase("CASE-PHONE-B", { difficulty: "investigator" });
    const b = generateCase("CASE-PHONE-B", { difficulty: "investigator" });
    expect(a.victimPhone).toEqual(b.victimPhone);
  });

  it("[D] no message or call timestamp falls after the crime (the victim's death)", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-PHONE-D-${i}`, { difficulty: "investigator" });
      for (const conv of truth.victimPhone.conversations) {
        for (const m of conv.messages) {
          expect(m.timestamp).toBeLessThan(truth.crimeTimestamp);
        }
      }
      for (const call of truth.victimPhone.calls) {
        expect(call.timestamp).toBeLessThan(truth.crimeTimestamp);
      }
    }
  });

  it("[E] every contact with a personId resolves to a real person in the case", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-PHONE-E-${i}`, { difficulty: "investigator" });
      const peopleIds = new Set(truth.people.map((p) => p.id));
      for (const contact of truth.victimPhone.contacts) {
        if (contact.personId !== null) expect(peopleIds.has(contact.personId)).toBe(true);
      }
      // Every conversation/call references a real contact.
      const contactIds = new Set(truth.victimPhone.contacts.map((c) => c.id));
      for (const conv of truth.victimPhone.conversations) expect(contactIds.has(conv.contactId)).toBe(true);
      for (const call of truth.victimPhone.calls) expect(contactIds.has(call.contactId)).toBe(true);
    }
  });

  it("[F] conversation messages are sorted chronologically", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-PHONE-F-${i}`, { difficulty: "investigator" });
      for (const conv of truth.victimPhone.conversations) {
        for (let j = 1; j < conv.messages.length; j++) {
          expect(conv.messages[j].timestamp).toBeGreaterThanOrEqual(conv.messages[j - 1].timestamp);
        }
      }
    }
  });

  it("[G] call timestamps are valid (well-formed, non-negative duration when answered)", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-PHONE-G-${i}`, { difficulty: "investigator" });
      for (const call of truth.victimPhone.calls) {
        expect(Number.isFinite(call.timestamp)).toBe(true);
        if (call.answered) {
          expect(call.durationSeconds).not.toBeNull();
          expect(call.durationSeconds!).toBeGreaterThan(0);
        } else {
          expect(call.durationSeconds).toBeNull();
        }
      }
    }
  });

  it("[I] mundane (non-flavored-family) content exists — the phone isn't only clue text", () => {
    const truth = generateCase("CASE-PHONE-I", { difficulty: "investigator" });
    const allMessages = truth.victimPhone.conversations.flatMap((c) => c.messages);
    expect(allMessages.length).toBeGreaterThan(0);
    // At least some messages should be drawn from the universal mundane
    // pool rather than every single one reading as a "clue" — a loose
    // sanity check on volume, not a strict ratio (the brief calls the
    // 60-80% split a design target, not a hard runtime rule).
    expect(allMessages.length).toBeGreaterThan(truth.victimPhone.contacts.length);
  });

  it("[J] multiple contacts are possible in a single case", () => {
    const truth = generateCase("CASE-PHONE-J", { difficulty: "investigator" });
    expect(truth.victimPhone.contacts.length).toBeGreaterThanOrEqual(2);
  });

  it("[K] no player-facing hidden-flag field appears anywhere in the serialized phone payload", () => {
    for (let i = 0; i < 10; i++) {
      const truth = generateCase(`CASE-PHONE-K-${i}`, { difficulty: "investigator" });
      const payload = JSON.stringify(truth.victimPhone);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(payload).not.toContain(`"${forbidden}"`);
      }
    }
  });

  it("generates a discoverable victim_phone evidence item tied only to the victim, never the culprit", () => {
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-PHONE-DEVICE-${i}`, { difficulty: "investigator" });
      const deviceItems = truth.evidence.filter((e) => e.type === "victim_phone");
      expect(deviceItems).toHaveLength(1);
      const device = deviceItems[0];
      expect(device.relatedPersonIds).toEqual([truth.victimId]);
      expect(device.relatedPersonIds).not.toContain(truth.culpritId);
      expect(device.requiresLabAnalysis).toBe("digital_forensics");
      expect(device.family).toBe("physical");
      expect(device.isRedHerring).toBe(false);
    }
  });

  it("the victim-phone layer never contributes a computeSolvability channel by construction (not evidence[])", async () => {
    const { computeSolvability } = await import("../../validator/solvability");
    const truth = generateCase("CASE-PHONE-SOLV", { difficulty: "investigator" });
    // Sanity: victimPhone truly isn't part of evidence[].
    expect((truth as unknown as { evidence: unknown[] }).evidence).not.toContain(truth.victimPhone);
    // computeSolvability must not throw or behave differently whether or
    // not victimPhone exists — it should never even look at it.
    const result = computeSolvability(truth);
    const withoutPhone = computeSolvability({ ...truth, victimPhone: { ownerPersonId: truth.victimId, contacts: [], conversations: [], calls: [] } });
    expect(result).toEqual(withoutPhone);
  });
});
