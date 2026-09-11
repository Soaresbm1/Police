import { describe, expect, it } from "vitest";
import { generateCase } from "../case-truth";
import { computeMotiveSupport } from "../../validator/motive-support";
import { MUNDANE_LINES } from "../victim-phone";

const MUNDANE_LINE_SET = new Set(MUNDANE_LINES);

/**
 * Motive & Digital Evidence Phase 1 — full-scale diagnostics (project
 * brief §34). Gated behind an env var and skipped by default, the same
 * convention `case-variety-stats.test.ts`/`investigation-clarity-
 * stress.test.ts` already established. Run on demand with:
 *   RUN_PHONE_STATS=1 npx vitest run lib/game-engine/case-generator/__tests__/motive-digital-evidence-stress.test.ts
 */
const RUN_FULL = process.env.RUN_PHONE_STATS === "1";
const CASE_COUNT = RUN_FULL ? 2000 : 80;

describe.skipIf(false)("motive & digital evidence — full stress/distribution", () => {
  it(`generates ${CASE_COUNT} complete cases and reports phone/motive/bias/consistency stats`, () => {
    let thrown = 0;
    let totalConversations = 0;
    let totalMessages = 0;
    let totalCalls = 0;
    let mundaneCount = 0;
    let flavoredCount = 0;
    let unknownNumberContacts = 0;
    let zeroMessageConversations = 0;

    let motiveAtLeast2 = 0;
    let motiveAtLeast3 = 0;
    const motiveChannelCounts: number[] = [];
    const weakestByMotive = new Map<string, number>();

    let culpritIsContact = 0;
    let culpritFirstConversation = 0;
    let culpritLatestConversation = 0;
    let culpritLastCaller = 0;
    let culpritMostMessaged = 0;

    let invalidPersonRefs = 0;
    let postDeathMessages = 0;
    let hiddenFieldLeaks = 0;

    const FORBIDDEN_KEYS = ["culpritId", "actualMotive", "isMotiveClue", "crimeRelevance", "templateCategory", "truthRole", "hiddenRelationship"];

    for (let i = 0; i < CASE_COUNT; i++) {
      try {
        const truth = generateCase(`CASE-PHONESTRESS-${i}`, { difficulty: "investigator" });
        const phone = truth.victimPhone;
        const peopleIds = new Set(truth.people.map((p) => p.id));

        totalConversations += phone.conversations.length;
        totalCalls += phone.calls.length;

        for (const contact of phone.contacts) {
          if (contact.personId === null) unknownNumberContacts++;
          else if (!peopleIds.has(contact.personId)) invalidPersonRefs++;
        }

        for (const conv of phone.conversations) {
          if (conv.messages.length === 0) zeroMessageConversations++;
          totalMessages += conv.messages.length;
          for (const m of conv.messages) {
            if (m.timestamp >= truth.crimeTimestamp) postDeathMessages++;
          }
        }
        for (const call of phone.calls) {
          if (call.timestamp >= truth.crimeTimestamp) postDeathMessages++;
        }

        const payload = JSON.stringify(phone);
        for (const key of FORBIDDEN_KEYS) {
          if (payload.includes(`"${key}"`)) hiddenFieldLeaks++;
        }

        // Exact mundane/flavored split, per message: a message is
        // "mundane" iff its content is drawn from the universal mundane
        // pool (excludes the one-off lure-message lines, which are their
        // own small, neutral category — counted here as flavored since
        // they're timing clues, not everyday chatter).
        for (const conv of phone.conversations) {
          for (const m of conv.messages) {
            if (MUNDANE_LINE_SET.has(m.content)) mundaneCount++;
            else flavoredCount++;
          }
        }

        const support = computeMotiveSupport(truth);
        motiveChannelCounts.push(support.channelCount);
        if (support.channelCount >= 2) motiveAtLeast2++;
        if (support.channelCount >= 3) motiveAtLeast3++;
        const prevWeak = weakestByMotive.get(support.motive) ?? Infinity;
        weakestByMotive.set(support.motive, Math.min(prevWeak, support.channelCount));

        const culpritContact = phone.contacts.find((c) => c.personId === truth.culpritId);
        if (culpritContact) {
          culpritIsContact++;
          const sortedConvs = [...phone.conversations]
            .filter((c) => c.messages.length > 0)
            .sort((a, b) => Math.max(...b.messages.map((m) => m.timestamp)) - Math.max(...a.messages.map((m) => m.timestamp)));
          if (sortedConvs[0]?.contactId === culpritContact.id) {
            culpritFirstConversation++;
            culpritLatestConversation++;
          }
          const sortedCalls = [...phone.calls].sort((a, b) => b.timestamp - a.timestamp);
          if (sortedCalls[0]?.contactId === culpritContact.id) culpritLastCaller++;
          const messageCounts = phone.conversations.map((c) => ({ id: c.contactId, count: c.messages.length }));
          const maxCount = Math.max(0, ...messageCounts.map((m) => m.count));
          if (maxCount > 0 && messageCounts.some((m) => m.id === culpritContact.id && m.count === maxCount)) culpritMostMessaged++;
        }
      } catch {
        thrown++;
      }
    }

    console.log("=== PHONE STATS ===", {
      caseCount: CASE_COUNT,
      avgConversations: (totalConversations / CASE_COUNT).toFixed(2),
      avgMessages: (totalMessages / CASE_COUNT).toFixed(2),
      avgCalls: (totalCalls / CASE_COUNT).toFixed(2),
      mundanePct: ((mundaneCount / Math.max(1, mundaneCount + flavoredCount)) * 100).toFixed(1),
      flavoredPct: ((flavoredCount / Math.max(1, mundaneCount + flavoredCount)) * 100).toFixed(1),
      unknownNumberContacts,
      zeroMessageConversations,
    });
    console.log("=== MOTIVE STATS ===", {
      atLeast2Pct: ((motiveAtLeast2 / CASE_COUNT) * 100).toFixed(1),
      atLeast3Pct: ((motiveAtLeast3 / CASE_COUNT) * 100).toFixed(1),
      weakestByMotive: Object.fromEntries(weakestByMotive),
      avgChannels: (motiveChannelCounts.reduce((a, b) => a + b, 0) / CASE_COUNT).toFixed(2),
    });
    console.log("=== BIAS ===", {
      culpritIsContactPct: ((culpritIsContact / CASE_COUNT) * 100).toFixed(1),
      culpritFirstConversationPct: ((culpritFirstConversation / Math.max(1, culpritIsContact)) * 100).toFixed(1),
      culpritLatestConversationPct: ((culpritLatestConversation / Math.max(1, culpritIsContact)) * 100).toFixed(1),
      culpritLastCallerPct: ((culpritLastCaller / Math.max(1, culpritIsContact)) * 100).toFixed(1),
      culpritMostMessagedPct: ((culpritMostMessaged / Math.max(1, culpritIsContact)) * 100).toFixed(1),
    });
    console.log("=== CONSISTENCY ===", { invalidPersonRefs, postDeathMessages, hiddenFieldLeaks, thrown });

    expect(thrown).toBe(0);
    expect(invalidPersonRefs).toBe(0);
    expect(postDeathMessages).toBe(0);
    expect(hiddenFieldLeaks).toBe(0);
    expect(motiveAtLeast2 / CASE_COUNT).toBeGreaterThanOrEqual(0.95);
  });
});
