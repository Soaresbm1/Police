import type { CCTVFrameDescriptor } from "./cctv";
import type { TimelineEvent } from "@/lib/game-engine/types/timeline";
import type { GameMinutes } from "@/lib/game-engine/types/time";
import { hashSeed, pickRange } from "./hash";

/**
 * Deterministic CCTV animation (Phase 3 — Motive & Digital Evidence /
 * Immersive Investigation). Turns one already-existing, already-safe
 * `CCTVFrameDescriptor` (see `cctv.ts`) into a playable sequence descriptor —
 * a projection, never a new source of truth.
 *
 * Grounding rule: everything an actor does here is derived from the
 * `TimelineEvent` that produced the underlying `camera_footage`/
 * `dashcam_footage` evidence (`evidence.sourceEventId`, resolved by the
 * caller against `CaseTruth.timeline`). That event's `timestamp` is when the
 * person's presence at this location genuinely began, and its
 * `durationMinutes` is how long they were genuinely still there — so an
 * actor "entering frame" at sequence start and, for a short real event,
 * "exiting frame" before the clip ends are both facts the event already
 * establishes, never invented ones. A long real event (a work shift, a
 * multi-hour visit) simply leaves the actor on-screen for the whole clip —
 * we never show or imply a departure we have no timestamp for.
 *
 * Every other value here (grain seed, exact pixel path, gait phase, clip
 * length within its bucket, cosmetic clock seconds) is COSMETIC PRESENTATION
 * — see the module-level "cosmetic-only" fields below. It is derived from a
 * seed isolated to this module (`cctv-animation-v1:<evidenceId>`), never
 * from the shared case-generation RNG, so building or not building a
 * sequence can never perturb `CaseTruth` (req. 2/33). These fields must
 * NEVER be read by evidence, scoring, hints, interrogation, timeline, or
 * solvability code (req. 31) — they exist purely for the player-facing
 * renderer.
 */

export type CCTVVisualEventType = "enter_frame" | "exit_frame" | "motion_detected";

export interface CCTVVisualEvent {
  /** Seconds elapsed since sequence start — always within [0, durationSeconds]. */
  atSecond: number;
  type: CCTVVisualEventType;
  /** Null for the location-level "motion_detected" marker; otherwise the
   * `CCTVActor.visualId` this event belongs to. */
  actorVisualId: string | null;
}

export interface CCTVActor {
  visualId: string;
  /** Mirrors `CCTVFrameDescriptor.identifiable` for this evidence — never a
   * person id. Rendering/labels stay exactly as truth-safe as the existing
   * static viewer: identity, when legitimate, is shown in the text panel
   * beside the footage (`identifiedNamesForCCTV`), never drawn into the
   * canvas itself. */
  identifiable: boolean;
  /** Cosmetic-only silhouette variance — never evidentiary. */
  appearance: { heightBucket: 0 | 1 | 2; gaitSeed: number };
  /** Normalized horizontal path, 0-100 (percent of frame width). */
  path: { xEntry: number; xExit: number; lane: 0 | 1 | 2 };
  /** Seconds elapsed since sequence start when this actor is first visible. */
  visibleFrom: number;
  /** Seconds elapsed since sequence start when this actor leaves frame, or
   * `null` if they are still present when the clip ends (a long real-world
   * event whose end this short excerpt doesn't reach). */
  visibleUntil: number | null;
}

export interface CCTVSequenceDescriptor {
  evidenceId: string;
  cameraId: string;
  locationId: string;
  /** The real, immutable start of this observation (== the evidence's own
   * timestamp / the source event's timestamp). */
  startTime: GameMinutes;
  /** Cosmetic-only: seconds-within-the-minute the on-screen clock starts
   * ticking from, purely for a believable HH:MM:SS overlay — the underlying
   * case clock has no sub-minute resolution at all. */
  clockStartSecond: number;
  durationSeconds: number;
  /** Simulated camera cadence (frames/sec the renderer should visually step
   * at) — cosmetic only, never affects playback control timing. */
  fps: number;
  quality: CCTVFrameDescriptor["visibilityQuality"];
  actors: CCTVActor[];
  visualEvents: CCTVVisualEvent[];
  /** Cosmetic-only seed for grain/scanline rendering variance. */
  grainSeed: number;
}

const MIN_SEQUENCE_SECONDS = 10;
const MAX_SEQUENCE_SECONDS = 40;

/** An event this short (a waypoint sighting mid-travel) genuinely ends
 * within a plausible clip length — the actor may safely be shown entering
 * AND exiting. Above this, we only know they were STILL there when our
 * short excerpt runs out, never that they left. */
const SHORT_EVENT_MINUTES_CUTOFF = 3;

const EXIT_MARGIN_SECONDS = 2;

function durationBucket(realDurationMinutes: number): [number, number] {
  if (realDurationMinutes <= SHORT_EVENT_MINUTES_CUTOFF) return [MIN_SEQUENCE_SECONDS, 18];
  if (realDurationMinutes <= 20) return [16, 28];
  return [22, MAX_SEQUENCE_SECONDS];
}

/**
 * Builds the one safe, deterministic sequence descriptor for a CCTV/dashcam
 * evidence item, or `null` if there isn't enough grounded temporal
 * information to animate (the caller should fall back to the existing
 * static viewer — never crash, never invent one). In practice every
 * `camera_footage`/`dashcam_footage` evidence item has a resolvable
 * `sourceEventId` (see `evidence-generator.ts`), so `null` is only a
 * defensive path for otherwise-malformed input.
 */
export function buildCCTVSequence(
  evidenceId: string,
  frame: CCTVFrameDescriptor,
  sourceEvent: TimelineEvent | undefined,
): CCTVSequenceDescriptor | null {
  if (!sourceEvent) return null;

  const seedBase = `cctv-animation-v1:${evidenceId}`;
  const realDurationMinutes = Math.max(sourceEvent.durationMinutes, 0);
  const [minSeconds, maxSeconds] = durationBucket(realDurationMinutes);
  const durationSeconds = pickRange(`${seedBase}:duration`, minSeconds, maxSeconds);
  const isShortEvent = realDurationMinutes <= SHORT_EVENT_MINUTES_CUTOFF;

  const actorCount = frame.identifiable ? Math.max(1, frame.visiblePersonIds.length) : 1;
  const actors: CCTVActor[] = [];
  const visualEvents: CCTVVisualEvent[] = [];
  let earliestEnter = durationSeconds;

  for (let i = 0; i < actorCount; i++) {
    const actorSeed = `${seedBase}:actor${i}`;
    const visualId = `actor-${i}`;
    const enteringFromLeft = i % 2 === 0;
    const xEntry = enteringFromLeft ? pickRange(`${actorSeed}:xin`, 4, 22) : pickRange(`${actorSeed}:xin`, 78, 96);
    const xExit = enteringFromLeft ? pickRange(`${actorSeed}:xout`, 78, 96) : pickRange(`${actorSeed}:xout`, 4, 22);
    const lane = pickRange(`${actorSeed}:lane`, 0, 2) as 0 | 1 | 2;

    // Stagger multiple actors' entries a little rather than having them all
    // step into frame at the exact same instant — cosmetic only, always
    // within the clip's own bounds.
    const staggerCap = Math.max(0, Math.floor(durationSeconds / 4) - i);
    const visibleFrom = i === 0 ? 0 : pickRange(`${actorSeed}:enter`, 0, staggerCap);

    let visibleUntil: number | null;
    if (isShortEvent) {
      const latestExit = Math.max(visibleFrom + 1, durationSeconds - EXIT_MARGIN_SECONDS);
      const earliestExit = Math.min(latestExit, visibleFrom + 4);
      visibleUntil = pickRange(`${actorSeed}:exit`, earliestExit, latestExit);
    } else {
      // Genuinely still there — this excerpt ends before we know they left.
      visibleUntil = null;
    }

    actors.push({
      visualId,
      identifiable: frame.identifiable,
      appearance: {
        heightBucket: pickRange(`${actorSeed}:height`, 0, 2) as 0 | 1 | 2,
        gaitSeed: hashSeed(`${actorSeed}:gait`) % 1000,
      },
      path: { xEntry, xExit, lane },
      visibleFrom,
      visibleUntil,
    });

    visualEvents.push({ atSecond: visibleFrom, type: "enter_frame", actorVisualId: visualId });
    if (visibleUntil !== null) {
      visualEvents.push({ atSecond: visibleUntil, type: "exit_frame", actorVisualId: visualId });
    }
    earliestEnter = Math.min(earliestEnter, visibleFrom);
  }

  // A single, location-level "motion detected" marker — legitimate because
  // the underlying evidence already establishes motion happened; never a
  // per-actor relevance flag (req. 20).
  visualEvents.push({ atSecond: earliestEnter, type: "motion_detected", actorVisualId: null });
  visualEvents.sort((a, b) => a.atSecond - b.atSecond);

  return {
    evidenceId,
    cameraId: frame.cameraId,
    locationId: frame.locationId,
    startTime: sourceEvent.timestamp,
    clockStartSecond: pickRange(`${seedBase}:clock`, 0, 59),
    durationSeconds,
    fps: pickRange(`${seedBase}:fps`, 8, 15),
    quality: frame.visibilityQuality,
    actors,
    visualEvents,
    grainSeed: hashSeed(`${seedBase}:grain`) % 1000,
  };
}
