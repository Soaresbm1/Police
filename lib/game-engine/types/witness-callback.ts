import type { PersonId } from "./person";
import type { GameMinutes } from "./time";

/**
 * A witness's predetermined later recollection — never invented at callback
 * time. Each callback is a reference to a `KnowledgeFact`/`TestimonyLine`
 * pair that already existed, fully determined, when the case was
 * generated; `content` is always exactly `KnowledgeFact.believedStatement`
 * — the witness's own current belief, corrupted or not — never
 * `trueStatement`. There is deliberately no `correction` kind: nothing in
 * the current knowledge model represents a witness's own, independently
 * predetermined capacity to later recover the accurate version of a
 * corrupted fact, and inventing one is out of scope for this phase (see
 * `witness/witness-callbacks.ts#deriveWitnessCallbacks`).
 */
export type WitnessCallbackKind = "voluntary_disclosure" | "clarification";

export interface WitnessCallback {
  id: string;
  personId: PersonId;
  kind: WitnessCallbackKind;
  /** The KnowledgeFact this callback resolves. */
  factId: string;
  /** The originally-recorded TestimonyLine being revisited. */
  testimonyLineId: string;
  /** Always exactly `KnowledgeFact.believedStatement` — the witness's own
   * current belief, corrupted or not — copied verbatim from the immutable
   * generated fact. Never `KnowledgeFact.trueStatement`: a callback must
   * never use CaseTruth's omniscience to repair a witness's memory. */
  content: string;
  /** Fixed at derivation time, independent of when in gameplay the first
   * interview actually happens — see `EVENT_DELAY_MINUTES` sibling logic
   * in `lib/game-session/events.ts`. */
  delayMinutes: GameMinutes;
}
