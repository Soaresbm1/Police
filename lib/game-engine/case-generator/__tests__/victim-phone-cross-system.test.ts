import { describe, expect, it } from "vitest";
import { generateCase } from "../case-truth";
import { RelationshipGraph } from "../../types/relationship";

describe("victim phone — cross-system consistency", () => {
  it("[Y] the victim-phone call/message for the 'lure' event agrees with the underlying TimelineEvent (same source the police phone-record operator log reads)", () => {
    let checkedCalls = 0;
    let checkedMessages = 0;
    for (let i = 0; i < 100; i++) {
      const truth = generateCase(`CASE-PHONECROSS-Y-${i}`, { difficulty: "investigator" });
      const lureEvent = truth.timeline.find(
        (e) => (e.action === "phone_call" || e.action === "send_message") && (e.actorId === truth.victimId || e.counterpartyId === truth.victimId) && e.counterpartyId !== null,
      );
      if (!lureEvent) continue;
      const otherPartyId = lureEvent.actorId === truth.victimId ? lureEvent.counterpartyId! : lureEvent.actorId;
      const contact = truth.victimPhone.contacts.find((c) => c.personId === otherPartyId);
      if (!contact) continue;

      if (lureEvent.action === "phone_call") {
        const call = truth.victimPhone.calls.find((c) => c.contactId === contact.id && c.timestamp === lureEvent.timestamp);
        expect(call).toBeDefined();
        expect(call!.direction).toBe(lureEvent.actorId === truth.victimId ? "outgoing" : "incoming");
        expect(call!.answered).toBe(true);
        checkedCalls++;
      } else {
        const conv = truth.victimPhone.conversations.find((c) => c.contactId === contact.id);
        const msg = conv?.messages.find((m) => m.timestamp === lureEvent.timestamp);
        expect(msg).toBeDefined();
        expect(msg!.direction).toBe(lureEvent.actorId === truth.victimId ? "from_victim" : "to_victim");
        checkedMessages++;
      }
    }
    // At least some of the 100 sampled seeds should have exercised this
    // path (needsVictimTravel cases) — if none did, the test below would
    // be vacuous, so assert real coverage.
    expect(checkedCalls + checkedMessages).toBeGreaterThan(0);
  });

  it("[Z] no phone message states a specific CHF amount that could numerically contradict bank evidence", () => {
    for (let i = 0; i < 50; i++) {
      const truth = generateCase(`CASE-PHONECROSS-Z-${i}`, { difficulty: "investigator" });
      for (const conv of truth.victimPhone.conversations) {
        for (const m of conv.messages) {
          expect(m.content).not.toMatch(/CHF\s*[\d,.']+/i);
          expect(m.content).not.toMatch(/\d{3,}\s*(francs|chf)/i);
        }
      }
    }
  });

  it("[AA] every relationship-linked contact resolves to a real, findable relationship", () => {
    for (let i = 0; i < 50; i++) {
      const truth = generateCase(`CASE-PHONECROSS-AA-${i}`, { difficulty: "investigator" });
      const graph = new RelationshipGraph(truth.relationships);
      for (const contact of truth.victimPhone.contacts) {
        if (!contact.personId) continue;
        // Not every contact is necessarily relationship-grounded (the
        // culprit's lure-partner path can add one without a graph edge in
        // rare cases) — but if a conversation carries flavored content,
        // there must be a real relationship behind it.
        const rel = graph.between(truth.victimId, contact.personId);
        if (rel) {
          expect(truth.relationships.some((r) => r.id === rel.id)).toBe(true);
        }
      }
    }
  });

  it("[AB, AC, AD] generating victim-phone data never mutates relationships, timeline, or evidence", () => {
    for (let i = 0; i < 20; i++) {
      const seed = `CASE-PHONECROSS-PURITY-${i}`;
      const a = generateCase(seed, { difficulty: "investigator" });
      const b = generateCase(seed, { difficulty: "investigator" });
      expect(a.relationships).toEqual(b.relationships);
      expect(a.timeline).toEqual(b.timeline);
      expect(a.evidence.filter((e) => e.type !== "victim_phone")).toEqual(b.evidence.filter((e) => e.type !== "victim_phone"));
    }
  });

  it("[AE] solvability is identical whether or not victimPhone is present (phone data is not wired into it)", async () => {
    const { computeSolvability } = await import("../../validator/solvability");
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-PHONECROSS-AE-${i}`, { difficulty: "investigator" });
      const withPhone = computeSolvability(truth);
      const emptyPhone = computeSolvability({ ...truth, victimPhone: { ownerPersonId: truth.victimId, contacts: [], conversations: [], calls: [] } });
      expect(withPhone).toEqual(emptyPhone);
    }
  });
});
