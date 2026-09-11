import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { GameMinutes } from "../types/time";
import type { Evidence } from "../types/evidence";
import type { VictimPhoneData, PhoneContact, PhoneConversation, PhoneMessage, PhoneCall } from "../types/phone";

/**
 * Motive & Digital Evidence, Phase 1 — the victim's phone. Everything here
 * runs ONCE, at case-generation time, from `rootRng.derive("victim-phone")`
 * (see `case-truth.ts`) — never on open/select/interrogate/accuse. The
 * result is plain immutable data on `CaseTruth.victimPhone`, structurally
 * separate from `CaseTruth.evidence` (like `postCrimeMovements`), so it can
 * never be picked up by `computeSolvability` — which only ever iterates
 * `evidence[]` — unless a future phase intentionally wires it in.
 *
 * Content is deterministic templated French, never an LLM. Messages never
 * carry a hidden "this is the clue" flag: `classifyRelationshipForPhone`
 * below is the ONLY place that maps a relationship to a content flavor, and
 * it is never stored on the returned data — a future diagnostic (see
 * `validator/motive-support.ts`) re-derives the same classification
 * independently from `relationships`, purely for server/test-side
 * measurement, never exposed to the browser.
 */

export type PhoneTemplateFamily =
  | "neutral_mundane"
  | "financial_dispute"
  | "relationship_tension"
  | "secret_fear"
  | "family_tension"
  | "professional_dispute"
  | "personal_rivalry";

/**
 * Mirrors (loosely — deliberately a bit more permissive) `motive.ts`'s
 * `directMotiveFromRelationship` branch structure, but maps to a CONTENT
 * flavor instead of a motive. Being more permissive than the motive
 * engine's own strength thresholds is intentional: a relationship just
 * under the motive cutoff can still read as mildly tense phone content —
 * exactly the honest, non-labeled red-herring material req. 12 asks for.
 */
export function classifyRelationshipForPhone(rel: Relationship): PhoneTemplateFamily {
  const a = rel.attributes;
  switch (rel.type) {
    case "spouse":
    case "partner":
      return a.jealousy > 0.5 || a.hatred > 0.45 ? "relationship_tension" : "neutral_mundane";
    case "ex_partner":
      return a.hatred > 0.35 || a.jealousy > 0.35 ? "relationship_tension" : "neutral_mundane";
    case "affair":
      return a.fear > 0.3 ? "secret_fear" : "neutral_mundane";
    case "creditor_debtor":
      return a.debtChf > 10_000 ? "financial_dispute" : "neutral_mundane";
    case "family":
      return a.dependency > 0.35 || a.trust < 0.4 ? "family_tension" : "neutral_mundane";
    case "boss":
    case "employee":
      return a.trust < 0.35 ? "professional_dispute" : "neutral_mundane";
    case "rival":
    case "conflict":
      return a.hatred > 0.3 ? "personal_rivalry" : "neutral_mundane";
    default:
      return "neutral_mundane";
  }
}

/** Exported for diagnostics only (e.g. the stress test's mundane/flavored
 * split measurement) — content strings are never sensitive, so exporting
 * this list carries no truth-safety risk. */
export const MUNDANE_LINES: string[] = [
  "Tu es où ?",
  "J'arrive dans 10 minutes.",
  "On se voit ce soir ?",
  "N'oublie pas le pain en rentrant.",
  "Joyeux anniversaire !",
  "Tu as vu l'heure qu'il est ?",
  "Ça te dit un café demain ?",
  "Je suis coincé·e dans les bouchons.",
  "Merci encore pour hier.",
  "On se rappelle plus tard ?",
  "Tu peux récupérer les enfants ?",
  "J'ai réservé le restaurant pour vendredi.",
  "Il faut qu'on parle du rendez-vous chez le médecin.",
  "Tu as pensé à arroser les plantes ?",
  "Bonne journée !",
  "Rentre bien.",
  "Ok, à plus tard.",
  "Désolé·e, j'ai complètement oublié.",
  "On se voit toujours samedi ?",
  "Appelle-moi quand tu peux.",
  "Tu as des nouvelles ?",
  "Ça fait longtemps, comment vas-tu ?",
  "Je passe te déposer ça demain.",
  "Tu bosses tard ce soir ?",
];

const FAMILY_LINES: Record<Exclude<PhoneTemplateFamily, "neutral_mundane">, { fromOther: string[]; fromVictim: string[] }> = {
  financial_dispute: {
    fromOther: [
      "Tu peux me rembourser cette semaine ?",
      "On doit encore régler cette histoire d'argent.",
      "Je n'ai toujours rien reçu.",
      "Ça fait deux fois que je te le demande.",
      "On en parle demain, pour l'argent ?",
    ],
    fromVictim: [
      "Je vais voir ce que je peux faire.",
      "On en reparle plus tard, ok ?",
      "Je m'en occupe, promis.",
      "Pas maintenant, s'il te plaît.",
      "Je sais, je sais. Laisse-moi un peu de temps.",
    ],
  },
  relationship_tension: {
    fromOther: [
      "On doit se parler, sérieusement.",
      "Tu ne réponds plus comme avant.",
      "J'en ai marre de ces disputes.",
      "Tu étais avec qui hier soir ?",
      "Je croyais qu'on avait réglé ça.",
    ],
    fromVictim: [
      "Pas maintenant, s'il te plaît.",
      "On en parle en face à face, pas par message.",
      "Arrête, tu dis n'importe quoi.",
      "Je ne veux pas me disputer encore.",
      "On verra ça plus tard.",
    ],
  },
  secret_fear: {
    fromOther: [
      "Personne ne doit savoir, d'accord ?",
      "J'ai peur que ça se sache.",
      "On ne peut plus continuer comme ça.",
      "Si jamais quelqu'un l'apprend...",
      "Efface ce message après l'avoir lu.",
    ],
    fromVictim: [
      "Ne t'inquiète pas, je gère.",
      "Ça restera entre nous.",
      "On doit être plus prudent·e·s.",
      "Je ne dirai rien, promis.",
      "On en parle une prochaine fois, pas ici.",
    ],
  },
  family_tension: {
    fromOther: [
      "Il faut qu'on parle de l'héritage.",
      "Tu sais que ça me concerne aussi.",
      "On ne peut pas continuer à éviter le sujet.",
      "La famille aurait voulu qu'on soit d'accord.",
      "Le notaire a encore appelé.",
    ],
    fromVictim: [
      "On verra ça en famille.",
      "Ce n'est pas le moment.",
      "Je ne veux pas en discuter par message.",
      "On en reparle après les fêtes.",
      "Laisse-moi encore réfléchir.",
    ],
  },
  professional_dispute: {
    fromOther: [
      "On doit reparler de ta décision.",
      "Ce n'est pas ce qui avait été convenu.",
      "Je ne suis pas d'accord avec la façon dont ça a été géré.",
      "Il faut clarifier les responsabilités.",
      "On en discute demain au bureau.",
    ],
    fromVictim: [
      "On règle ça au bureau, pas ici.",
      "Je maintiens ma position.",
      "On en reparle calmement demain.",
      "Ce n'est pas le lieu pour ça.",
      "Je comprends, mais ma décision est prise.",
    ],
  },
  personal_rivalry: {
    fromOther: [
      "Tu ne t'en sortiras pas comme ça.",
      "On n'a pas fini cette histoire.",
      "Je n'ai pas oublié ce que tu as fait.",
      "Ça ne va pas se passer comme tu le penses.",
      "On se recroisera, tôt ou tard.",
    ],
    fromVictim: [
      "Fiche-moi la paix.",
      "C'est du passé, laisse tomber.",
      "Je n'ai pas de temps à perdre avec ça.",
      "Arrête de m'écrire pour ça.",
      "On n'a rien à se dire.",
    ],
  },
};

/** Generic, non-revealing lines for the one real pre-crime contact (the
 * "lure" timeline event, when present — see `applyLureIfPresent` below).
 * Deliberately says nothing about WHY the meeting is happening — only that
 * one is. Never the ground-truth `TimelineEvent.description`, which can
 * name both parties explicitly. */
const LURE_MESSAGE_LINES = ["On se voit où ?", "Je serai là dans un instant.", "D'accord, à tout de suite.", "Ok, j'arrive."];

function randomPhoneNumber(rng: RNG): string {
  const rest = Array.from({ length: 7 }, () => rng.int(0, 9)).join("");
  return `079${rest}`.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, "0$2 $3 $4");
}

export interface VictimPhoneOptions {
  crimeTimestamp: GameMinutes;
  caseOpenedAt: GameMinutes;
}

/** The one real communication the timeline can already contain: the
 * culprit contacting the victim to set up the meeting (see
 * `simulation/timeline-engine.ts`'s `needsVictimTravel` branch) — present
 * in only some cases, never fabricated here. Reused verbatim (same
 * timestamp/direction/medium) rather than re-rolled, so the victim-phone
 * view can never contradict the police phone-record operator log for the
 * SAME underlying event (req. 18) — both read the one immutable
 * `TimelineEvent`, never generated independently. Content is a generic
 * line, never the ground-truth description (which can name the culprit). */
function findLureEvent(timeline: TimelineEvent[], victimId: PersonId): TimelineEvent | undefined {
  return timeline.find(
    (e) =>
      (e.action === "phone_call" || e.action === "send_message") &&
      (e.actorId === victimId || e.counterpartyId === victimId) &&
      e.counterpartyId !== null,
  );
}

function otherPartyOf(event: TimelineEvent, victimId: PersonId): PersonId {
  return event.actorId === victimId ? event.counterpartyId! : event.actorId;
}

export function generateVictimPhoneData(
  rng: RNG,
  victim: Person,
  people: Person[],
  relationships: Relationship[],
  timeline: TimelineEvent[],
  options: VictimPhoneOptions,
): VictimPhoneData {
  const graph = new RelationshipGraph(relationships);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const lureEvent = findLureEvent(timeline, victim.id);
  const lurePartnerId = lureEvent ? otherPartyOf(lureEvent, victim.id) : null;

  // Guaranteed contacts: every real relationship touching the victim. This
  // is what makes the culprit always reachable as a phone contact whenever
  // their motive is grounded in a relationship with the victim (it always
  // is — see `deriveMotiveCandidates`), without ever reading `culpritId`
  // here (this function only ever sees `people`/`relationships`/`timeline`).
  const relatedPersonIds = new Set<PersonId>();
  for (const rel of graph.of(victim.id)) {
    relatedPersonIds.add(rel.from === victim.id ? rel.to : rel.from);
  }
  if (lurePartnerId) relatedPersonIds.add(lurePartnerId);

  const contacts: PhoneContact[] = [];
  const conversations: PhoneConversation[] = [];
  const calls: PhoneCall[] = [];

  for (const personId of relatedPersonIds) {
    const person = peopleById.get(personId);
    if (!person) continue;
    const contactRng = rng.derive(`contact-${personId}`);
    const contact: PhoneContact = { id: contactRng.id("contact"), personId, phoneNumber: person.phoneNumber };
    contacts.push(contact);

    const rel = graph.between(victim.id, personId);
    const family = rel ? classifyRelationshipForPhone(rel) : "neutral_mundane";

    const conv = buildConversation(contactRng.derive("conversation"), contact.id, family, options);
    if (lureEvent && personId === lurePartnerId && lureEvent.action === "send_message") {
      conv.messages.push(buildLureMessage(contactRng.derive("lure-message"), lureEvent, victim.id));
      conv.messages.sort((a, b) => a.timestamp - b.timestamp);
    }
    if (conv.messages.length > 0) conversations.push(conv);

    const callList = buildCalls(contactRng.derive("calls"), contact.id, options);
    if (lureEvent && personId === lurePartnerId && lureEvent.action === "phone_call") {
      callList.push({
        id: contactRng.derive("lure-call").id("call"),
        contactId: contact.id,
        timestamp: lureEvent.timestamp,
        direction: lureEvent.actorId === victim.id ? "outgoing" : "incoming",
        answered: true,
        durationSeconds: 30 + (contactRng.derive("lure-call-duration").int(0, 90)),
      });
      callList.sort((a, b) => a.timestamp - b.timestamp);
    }
    calls.push(...callList);
  }

  // A handful of deliberately-unmapped "unknown number" contacts — pure
  // realism noise (req. 24), never resolved to a person.
  const unknownRng = rng.derive("unknown-numbers");
  const unknownCount = unknownRng.int(1, 3);
  for (let i = 0; i < unknownCount; i++) {
    const itemRng = unknownRng.derive(`unknown-${i}`);
    const contact: PhoneContact = { id: itemRng.id("contact"), personId: null, phoneNumber: randomPhoneNumber(itemRng.derive("number")) };
    contacts.push(contact);
    const conv = buildConversation(itemRng.derive("conversation"), contact.id, "neutral_mundane", options);
    if (conv.messages.length > 0) conversations.push(conv);
    calls.push(...buildCalls(itemRng.derive("calls"), contact.id, options));
  }

  calls.sort((a, b) => a.timestamp - b.timestamp);

  return { ownerPersonId: victim.id, contacts, conversations, calls };
}

function buildLureMessage(rng: RNG, lureEvent: TimelineEvent, victimId: PersonId): PhoneMessage {
  return {
    id: rng.id("msg"),
    timestamp: lureEvent.timestamp,
    direction: lureEvent.actorId === victimId ? "from_victim" : "to_victim",
    content: rng.pick(LURE_MESSAGE_LINES),
  };
}

/** 2-6 messages, mostly mundane (req. 7's 60-80% mundane / 20-40%
 * investigative target, measured across the WHOLE phone). Only
 * relationship-flavored contacts (see `classifyRelationshipForPhone`) ever
 * draw a family-specific line, and even then just over half the time — so
 * a flavored conversation still reads as mostly ordinary life with
 * occasional friction, never a wall of clue text; contacts whose
 * relationship classifies as neutral contribute purely mundane
 * conversations, which is what pulls the phone-wide average toward the
 * "mundane" end of the target band. */
function buildConversation(rng: RNG, contactId: string, family: PhoneTemplateFamily, options: VictimPhoneOptions): PhoneConversation {
  const countRng = rng.derive("count");
  const count = countRng.int(2, 6);
  const windowStart = options.crimeTimestamp - 14 * 24 * 60;
  const windowEnd = options.crimeTimestamp - 15; // always strictly before the crime

  const messages: PhoneMessage[] = [];
  for (let i = 0; i < count; i++) {
    const itemRng = rng.derive(`message-${i}`);
    const timestamp = Math.min(windowEnd, windowStart + itemRng.int(0, Math.max(1, windowEnd - windowStart)));
    const useFamilyLine = family !== "neutral_mundane" && itemRng.derive("use-family").bool(0.7);
    const directionRng = itemRng.derive("direction");
    let content: string;
    let direction: PhoneMessage["direction"];
    if (useFamilyLine) {
      const lib = FAMILY_LINES[family];
      const fromVictim = directionRng.bool(0.45);
      direction = fromVictim ? "from_victim" : "to_victim";
      content = fromVictim ? directionRng.derive("pick").pick(lib.fromVictim) : directionRng.derive("pick").pick(lib.fromOther);
    } else {
      direction = directionRng.bool(0.5) ? "from_victim" : "to_victim";
      content = directionRng.derive("pick").pick(MUNDANE_LINES);
    }
    messages.push({ id: itemRng.id("msg"), timestamp, direction, content });
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);
  return { id: rng.id("conv"), contactId, messages };
}

/** 0-3 calls per contact, independent of that contact's conversation. */
function buildCalls(rng: RNG, contactId: string, options: VictimPhoneOptions): PhoneCall[] {
  const countRng = rng.derive("count");
  const count = countRng.int(0, 3);
  const windowStart = options.crimeTimestamp - 14 * 24 * 60;
  const windowEnd = options.crimeTimestamp - 15;

  const calls: PhoneCall[] = [];
  for (let i = 0; i < count; i++) {
    const itemRng = rng.derive(`call-${i}`);
    const timestamp = Math.min(windowEnd, windowStart + itemRng.int(0, Math.max(1, windowEnd - windowStart)));
    const direction: PhoneCall["direction"] = itemRng.derive("direction").bool(0.5) ? "outgoing" : "incoming";
    const answered = itemRng.derive("answered").bool(0.75);
    calls.push({
      id: itemRng.id("call"),
      contactId,
      timestamp,
      direction,
      answered,
      durationSeconds: answered ? itemRng.derive("duration").int(15, 600) : null,
    });
  }
  return calls;
}

/**
 * The recovered phone device itself, as crime-scene evidence (req. 5) —
 * appended to `CaseTruth.evidence` the exact same additive way
 * `generateAmbientFinancialActivity` was (own isolated RNG sub-stream,
 * never inserted into or reordering the existing array). `family:
 * "physical"` + `relatedLocationIds: [crimeLocationId]` is enough for the
 * EXISTING crime-scene discovery flow (`discovery.ts#getCrimeSceneEvidence`)
 * to surface it automatically — no new discovery code needed.
 * `requiresLabAnalysis: "digital_forensics"` reuses the existing lab/
 * async-event machinery verbatim for "extraction" (req. 6) — no new
 * InvestigationEvent type, no artificial delay invented for this feature.
 * `relatedPersonIds` is ONLY the victim — never the culprit — so this item
 * can never itself contribute a `computeSolvability` channel.
 */
export function generateVictimPhoneDeviceEvidence(
  rng: RNG,
  victim: Person,
  crimeLocationId: string,
  crimeTimestamp: GameMinutes,
  caseOpenedAt: GameMinutes,
): Evidence {
  return {
    id: rng.id("ev"),
    family: "physical",
    type: "victim_phone",
    sourceEventId: null,
    sourceLocationId: crimeLocationId,
    relatedPersonIds: [victim.id],
    relatedLocationIds: [crimeLocationId],
    timestamp: crimeTimestamp,
    discoverableAt: caseOpenedAt,
    discoveryDifficulty: 0.2,
    reliability: "reliable",
    requiresLabAnalysis: "digital_forensics",
    isRedHerring: false,
    status: "undiscovered",
    description: "Téléphone portable retrouvé sur les lieux.",
  };
}
