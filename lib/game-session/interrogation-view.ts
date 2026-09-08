import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { TimelineActionType } from "@/lib/game-engine/types/timeline";
import { formatGameTime } from "@/lib/game-engine/types/time";
import type { GameSession } from "./types";

const ACTION_TOPIC_LABEL: Record<TimelineActionType, string> = {
  sleep: "sa soirée",
  wake_up: "sa matinée",
  travel: "ses déplacements",
  arrive: "son arrivée quelque part",
  leave: "son départ",
  work: "son activité professionnelle",
  meet: "une rencontre",
  phone_call: "un appel téléphonique",
  send_message: "un message envoyé",
  purchase: "un achat",
  withdraw_cash: "un retrait d'argent",
  argument: "une altercation",
  attack: "les événements de ce moment précis",
  conceal_evidence: "un fait qu'elle/il semble dissimuler",
  destroy_evidence: "un fait qu'elle/il semble dissimuler",
  clean: "une activité inhabituelle",
  flee: "ses déplacements",
  observe: "ce qu'elle/il a vu",
  stage_scene: "un fait qu'elle/il semble dissimuler",
  dispose_object: "un fait qu'elle/il semble dissimuler",
  avoid_location: "ses déplacements",
  other: "un fait précis",
};

export interface InterrogationTopic {
  factId: string;
  timeLabel: string;
  time: number;
  topicLabel: string;
  /** What the person actually says, in their own words. This is the only
   * thing the UI ever shows verbatim — never the underlying stance, which
   * would spoil whether it's true. */
  statement: string;
  asked: boolean;
}

const CONFESSION_FACT_ID = "confession";

/**
 * Builds the list of things the player can ask a given person about. Topics
 * are ordered chronologically by when the underlying fact occurred — this
 * is deliberate: it's what lets a player line up "she says she was home at
 * 22:00" against a wifi ping discovered elsewhere at the same time.
 *
 * A false confessor gets one extra, always-last topic: their full claimed
 * account (reconstruction, method, timing, motive) — a real interrogation
 * answer the player can compare against the autopsy and other evidence,
 * not just a flag revealed at the end.
 */
export function getInterrogationTopics(truth: CaseTruth, session: GameSession, personId: PersonId): InterrogationTopic[] {
  const eventsById = new Map(truth.timeline.map((e) => [e.id, e]));
  const asked = new Set(session.interrogated[personId] ?? []);

  const topics = truth.knowledge
    .filter((fact) => fact.personId === personId)
    .map((fact) => {
      const testimony = truth.testimony.find((t) => t.aboutFactId === fact.id);
      const event = eventsById.get(fact.aboutEventId);
      const action = event?.action ?? "other";
      return {
        factId: fact.id,
        time: fact.learnedAt,
        timeLabel: formatGameTime(fact.learnedAt),
        topicLabel: ACTION_TOPIC_LABEL[action],
        statement: testimony?.statement ?? "(refuse de commenter)",
        asked: asked.has(fact.id),
      };
    })
    .sort((a, b) => a.time - b.time);

  if (truth.falseConfession && truth.falseConfession.personId === personId) {
    const c = truth.falseConfession;
    topics.push({
      factId: CONFESSION_FACT_ID,
      time: c.claimedTimingStart,
      timeLabel: formatGameTime(c.claimedTimingStart),
      topicLabel: "avoue le crime",
      statement: `${c.claimedReconstruction} Méthode déclarée : ${c.claimedMethod}. Mobile déclaré : ${c.claimedMotiveText}`,
      asked: asked.has(CONFESSION_FACT_ID),
    });
  }

  return topics;
}

export function markAsked(session: GameSession, personId: PersonId, factId: string): void {
  const list = session.interrogated[personId] ?? [];
  if (!list.includes(factId)) {
    session.interrogated[personId] = [...list, factId];
  }
}
