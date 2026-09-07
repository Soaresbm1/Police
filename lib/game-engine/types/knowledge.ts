import type { PersonId } from "./person";
import type { GameMinutes } from "./time";

export type KnowledgeSource =
  | { kind: "direct_observation" }
  | { kind: "told_by"; personId: PersonId }
  | { kind: "document" }
  | { kind: "inference" };

/**
 * A single fact a person genuinely knows (or wrongly believes) at a point in
 * time. This is the backbone of the knowledge graph: a person may only ever
 * be asked to report on facts present in their own KnowledgeFact list, and
 * they may only acquire a fact via direct observation of a TimelineEvent
 * they were present for, or by being told it by someone who already knew it
 * at that time. No fact may be "known" before its source event happened.
 */
export interface KnowledgeFact {
  id: string;
  personId: PersonId;
  /** The timeline event this fact is ultimately about (even if learned second-hand). */
  aboutEventId: string;
  /** Ground-truth statement of what actually happened. */
  trueStatement: string;
  source: KnowledgeSource;
  learnedAt: GameMinutes;
  perceptionQuality: number;
  memoryQuality: number;
  confidence: number;
  /** True if this person's belief diverges from the ground truth due to a
   * perception/memory error (NOT a deliberate lie — see Testimony for lies). */
  isCorrupted: boolean;
  /** What they would actually report, if corrupted; equals trueStatement otherwise. */
  believedStatement: string;
}

export type TestimonyStance = "truthful" | "lie" | "omission" | "vague" | "refusal" | "contradiction";

/**
 * A single thing a person is willing/likely to say about a given fact when
 * asked, independent of the raw KnowledgeFact. This is what the interrogation
 * engine consumes; a future NarrativeProvider only rephrases this into
 * natural dialogue, it never invents or alters its truth value.
 */
export interface TestimonyLine {
  id: string;
  personId: PersonId;
  aboutFactId: string;
  stance: TestimonyStance;
  /** What they actually say, in factual (non-flavored) form. */
  statement: string;
  /** Why they chose this stance (fear, loyalty, guilt, self-protection...), for debug/design use. */
  motiveForStance: string;
}
