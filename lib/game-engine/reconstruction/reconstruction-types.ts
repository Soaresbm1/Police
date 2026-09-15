/**
 * Phase U5.1 — public, render-only types for the truth-safe crime
 * reconstruction. This is the ONLY file in `lib/game-engine/reconstruction/`
 * that may ever be imported by client code (once a Unity reconstruction
 * viewer exists in a later phase) — it deliberately imports nothing from
 * `CaseTruth` or any CaseTruth-adjacent type (`Person`, `TimelineEvent`,
 * `Location`, `Motive`, `Relationship`, ...), so there is nothing here a
 * bundler could ever pull a truth-carrying value through. Every other file
 * in this folder (`reconstruction-projector.ts`, `-layout.ts`, `-events.ts`)
 * imports `CaseTruth` and is marked `import "server-only"` — see
 * `reconstruction-projector.ts`'s doc comment for the full trust boundary.
 *
 * `ReconstructionScenario` is deliberately smaller than a first sketch of
 * "everything Unity might eventually want" — every field here traces back
 * to a concrete U5.0-audited CaseTruth capability (see that phase's report).
 * Nothing is included "because it sounds useful."
 */

export const RECONSTRUCTION_SCHEMA_VERSION = 1 as const;

/** Reuses the CCTV environment vocabulary where practical (U5.0 §10) — a
 * separate type on purpose, so a future change to CCTV's environment kinds
 * can never silently change reconstruction's, and vice versa. */
export type ReconstructionEnvironmentKind = "corridor" | "parking" | "shop" | "street" | "generic";

/**
 * The already-shipped post-resolution disclosure boundary (U5.0 §9,
 * verified directly against `lib/game-session/narrative-reconstruction.ts`):
 * the existing truth-reveal text already names the victim, the culprit, and
 * every accomplice — never witnesses, bystanders, or red herrings. This
 * type is the reconstruction's enforcement of that exact same boundary,
 * never wider.
 */
export type ReconstructionActorRole = "victim" | "culprit" | "accomplice" | "unnamed";

/**
 * A deliberately small V1 taxonomy (U5.0 §8), each value traceable to a
 * `TimelineActionType` the generator actually produces:
 *  - "meet"        <- action "meet" (first co-presence / arrival framing)
 *  - "talk"         <- action "argument" (the pre-crime confrontation)
 *  - "attack"       <- the unique `isCrimeEvent === true` event
 *  - "phone_use"    <- action "phone_call" | "send_message" (the lure —
 *                      defined for schema completeness; V1's projector
 *                      never emits it, see reconstruction-events.ts)
 *  - "leave_scene"  <- the culprit's post-attack "travel" (flee) event
 *  - "use_object"   <- defined for schema completeness; V1 folds weapon
 *                      handling into "attack"'s own `safeVisualAction`
 *                      instead of a separate event (no distinct truth
 *                      action for it — see reconstruction-events.ts)
 *  - "discover"     <- action "observe" (the discovery event)
 *  - "stage_scene"  <- action "stage_scene" (post-crime staging, if any)
 */
export type ReconstructionEventType = "meet" | "talk" | "attack" | "phone_use" | "leave_scene" | "use_object" | "discover" | "stage_scene";

/**
 * Presentation slots, not factual coordinates (U5.0 §9/§11 — no CaseTruth
 * field below the location-id level exists, so these are deterministic
 * STAGING choices, never a claim like "the victim stood exactly here").
 * Unity converts a slot to a visual position; this layer never does.
 */
export type ReconstructionSlot = "entrance" | "interaction" | "crime_point" | "interior_center" | "exit";

export interface ReconstructionWaypoint {
  /** Seconds since the scenario's own t=0 — never a GameMinutes value. */
  time: number;
  slot: ReconstructionSlot;
}

export interface ReconstructionActor {
  /** Opaque, deterministically derived id — never a raw PersonId or any
   * substring of one (see reconstruction-layout.ts#deriveActorVisualId). */
  visualId: string;
  roleForReconstruction: ReconstructionActorRole;
  /** A small deterministic cosmetic descriptor — never an attempt at the
   * person's actual likeness (see reconstruction-layout.ts). */
  genericAppearance: string;
  spawnTime: number;
  despawnTime: number;
  waypoints: ReconstructionWaypoint[];
}

export interface ReconstructionEvent {
  time: number;
  type: ReconstructionEventType;
  actorVisualId: string;
  counterpartyVisualId?: string;
  locationSlot: ReconstructionSlot;
  /** Cosmetic animation hint only — e.g. "attack_strike". Never implies a
   * fact beyond what CaseTruth's `methodType`/`involvedObject` supports
   * (see reconstruction-events.ts#safeVisualActionForMethod). */
  safeVisualAction?: string;
}

export interface ReconstructionScenario {
  version: typeof RECONSTRUCTION_SCHEMA_VERSION;
  /** The case's externally-safe identifier — e.g. a `case_history.id`.
   * NEVER the CaseSeed (a case's seed is spoiler-equivalent to its full
   * CaseTruth, since `generateCase(seed, difficulty)` is a pure function —
   * see U5.0 §14 and reconstruction-projector.ts's runtime assertion). */
  caseId: string;
  environment: ReconstructionEnvironmentKind;
  durationSeconds: number;
  actors: ReconstructionActor[];
  events: ReconstructionEvent[];
}
