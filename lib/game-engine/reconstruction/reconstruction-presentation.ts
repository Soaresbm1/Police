import type { ReconstructionEventType, ReconstructionScenario } from "./reconstruction-types";

/**
 * Presentation timeline for the player-facing reconstruction viewer. Client-safe: depends only on the public
 * scenario types.
 *
 * Truth time is `ReconstructionEvent.time`, never rewritten; Unity only ever evaluates truth time. The
 * presentation timeline decides how that truth is laid out for a player: in-scene intervals play 1:1, and a long
 * inactive gap between semantic events becomes a short "Plus tard…" transition instead of hours of nothing.
 */

/** Gaps between consecutive semantic events at least this long are presented as a skip. Mirrors
 * GapThresholdSeconds in Unity's ReconstructionTimelineSegmenter; kept as the event-level description of a
 * scenario's long gaps. The presentation itself skips by visual activity instead — see buildPresentationTimeline. */
export const GAP_THRESHOLD_SECONDS = 1800;

/**
 * Visible idle kept after the last thing that moved, before a skip starts, so a beat can be read before time
 * jumps. Presentation seconds, never truth seconds.
 */
export const POST_ACTIVITY_DWELL_SECONDS = 2;

/**
 * An idle stretch at least this long (truth seconds) is skipped rather than played. Shorter pauses play 1:1:
 * they read as natural beats, and skipping them would make the reconstruction feel hyperactive. Measured on
 * 2,000 generated scenarios, where the median case otherwise plays 37 minutes, 19 of them with nothing moving.
 */
export const IDLE_SKIP_THRESHOLD_SECONDS = 30;

/** Wall-clock length of the "Plus tard…" transition. Presentation only, never truth time. */
export const GAP_TRANSITION_MS = 1200;

/** Share of the in-scene playing time each compressed gap occupies on the timeline bar, so it stays visible
 * without pushing the beats it separates together. */
const GAP_BAR_FRACTION = 0.08;
const MIN_GAP_BAR_SECONDS = 3;

/** How long Unity shows the single attack beat (mirrors ReconstructionActorTimeline.AttackBeatSeconds). */
export const ATTACK_BEAT_SECONDS = 2;
/** How long the victim's collapse takes after the beat (mirrors ReconstructionActorTimeline.CollapseTransitionSeconds). */
export const COLLAPSE_TRANSITION_SECONDS = 1.5;
/**
 * Longest a walk between two slots is shown for (mirrors ReconstructionActorTimeline.MaxWalkSeconds). A leg is
 * walked at the END of its truth interval, arriving exactly at the recorded time, and the actor waits where it
 * started until then: truth records where someone was at each event, never that they crossed the scene slowly
 * for ten minutes.
 */
export const MAX_WALK_SECONDS = 8;
/** How long a non-attack semantic beat (talk, departure, discovery, staging) is treated as on-screen activity. */
export const EVENT_BEAT_SECONDS = 3;

export interface VisualActivityInterval {
  start: number;
  end: number;
  kind: "spawn" | "move" | "event" | "attack" | "collapse";
}

/**
 * Every truth interval in which the scene actually changes on screen: an actor appearing, walking between two
 * different slots, a semantic event beat, the attack beat and the victim's collapse. Standing still is not an
 * activity — an actor who has arrived and waits is visually identical from one second to the next, which is why
 * the presentation may skip that stretch without hiding anything the player could have seen.
 *
 * Derived only from the scenario Unity itself renders, so both sides agree on when something is visible.
 */
export function visualActivityIntervals(scenario: ReconstructionScenario): VisualActivityInterval[] {
  const intervals: VisualActivityInterval[] = [];
  const attack = scenario.events.find((e) => e.type === "attack");

  for (const actor of scenario.actors) {
    intervals.push({ start: actor.spawnTime, end: actor.spawnTime, kind: "spawn" });
    for (let i = 0; i < actor.waypoints.length - 1; i++) {
      const from = actor.waypoints[i];
      const to = actor.waypoints[i + 1];
      if (to.time > from.time && to.slot !== from.slot) {
        intervals.push({ start: to.time - Math.min(to.time - from.time, MAX_WALK_SECONDS), end: to.time, kind: "move" });
      }
    }
  }

  for (const event of scenario.events) {
    if (event.type === "attack") {
      intervals.push({ start: event.time, end: event.time + ATTACK_BEAT_SECONDS, kind: "attack" });
      if (event.counterpartyVisualId) {
        intervals.push({
          start: event.time + ATTACK_BEAT_SECONDS,
          end: event.time + ATTACK_BEAT_SECONDS + COLLAPSE_TRANSITION_SECONDS,
          kind: "collapse",
        });
      }
      continue;
    }
    intervals.push({ start: event.time, end: event.time + EVENT_BEAT_SECONDS, kind: "event" });
  }
  if (attack === undefined && scenario.events.length === 0) return [];

  return intervals.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The activity intervals merged into disjoint busy spans, in order. */
export function mergedActivitySpans(scenario: ReconstructionScenario): Array<{ start: number; end: number }> {
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of visualActivityIntervals(scenario)) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

export const EVENT_LABELS_FR: Record<ReconstructionEventType, string> = {
  meet: "RENCONTRE",
  talk: "DISCUSSION",
  attack: "AGRESSION",
  phone_use: "APPEL",
  leave_scene: "DÉPART",
  use_object: "OBJET",
  discover: "DÉCOUVERTE",
  stage_scene: "MISE EN SCÈNE",
};

export interface TimelineSegment {
  start: number;
  end: number;
  compressible: boolean;
}

/** Splits the timeline at every distinct event time; a segment at least GAP_THRESHOLD_SECONDS long is compressible. */
export function computeTimelineSegments(scenario: ReconstructionScenario): TimelineSegment[] {
  const times = [...new Set(scenario.events.map((e) => e.time))].sort((a, b) => a - b);
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  for (const t of times) {
    if (t > cursor) segments.push({ start: cursor, end: t, compressible: t - cursor >= GAP_THRESHOLD_SECONDS });
    cursor = t;
  }
  if (times.length > 0 && scenario.durationSeconds > cursor) {
    const end = scenario.durationSeconds;
    segments.push({ start: cursor, end, compressible: end - cursor >= GAP_THRESHOLD_SECONDS });
  }
  return segments;
}

export interface PresentationSegment {
  kind: "play" | "gap";
  /** For a gap: where the skip starts (after all movement has finished) and the truth time it lands on. */
  truthStart: number;
  truthEnd: number;
  barStart: number;
  barEnd: number;
}

export interface TimelineMarker {
  type: ReconstructionEventType;
  label: string;
  truthTime: number;
  barPosition: number;
}

export interface PresentationTimeline {
  segments: PresentationSegment[];
  /** Truth times where playback stops itself so the viewer can present the gap that follows. */
  holdPoints: number[];
  markers: TimelineMarker[];
  barDuration: number;
  truthDuration: number;
}

type Span = Pick<PresentationSegment, "kind" | "truthStart" | "truthEnd">;

/**
 * Lays the scenario out for a player: stretches where something is visibly happening play 1:1, and stretches
 * where nothing changes for longer than IDLE_SKIP_THRESHOLD_SECONDS are skipped after a short dwell.
 *
 * Truth is untouched. Event times, actor spawns and despawns all stay exactly as projected; the viewer simply
 * does not spend real seconds showing an interval in which the scene never changes, and says so with
 * "Plus tard…" every time it does skip one.
 */
export function buildPresentationTimeline(scenario: ReconstructionScenario): PresentationTimeline {
  const truthDuration = scenario.durationSeconds;
  const activity = mergedActivitySpans(scenario);

  const spans: Span[] = [];
  if (activity.length === 0) {
    pushPlay(spans, 0, truthDuration);
  } else {
    let playFrom = Math.min(0, activity[0].start);
    let previousEnd = activity[0].start;
    for (const span of activity) {
      const skipFrom = previousEnd + POST_ACTIVITY_DWELL_SECONDS;
      if (span.start - skipFrom >= IDLE_SKIP_THRESHOLD_SECONDS) {
        pushPlay(spans, playFrom, skipFrom);
        spans.push({ kind: "gap", truthStart: skipFrom, truthEnd: span.start });
        playFrom = span.start;
      }
      previousEnd = Math.max(previousEnd, span.end);
    }
    const tailFrom = Math.min(previousEnd + POST_ACTIVITY_DWELL_SECONDS, truthDuration);
    pushPlay(spans, playFrom, tailFrom);
    if (truthDuration - tailFrom >= IDLE_SKIP_THRESHOLD_SECONDS) {
      spans.push({ kind: "gap", truthStart: tailFrom, truthEnd: truthDuration });
    }
  }

  const playTotal = spans.filter((s) => s.kind === "play").reduce((sum, s) => sum + (s.truthEnd - s.truthStart), 0);
  const gapWidth = Math.max(MIN_GAP_BAR_SECONDS, Math.round(playTotal * GAP_BAR_FRACTION));

  let cursor = 0;
  const segments = spans.map((span) => {
    const width = span.kind === "play" ? span.truthEnd - span.truthStart : gapWidth;
    const segment: PresentationSegment = { ...span, barStart: cursor, barEnd: cursor + width };
    cursor += width;
    return segment;
  });

  const timeline: PresentationTimeline = {
    segments,
    holdPoints: segments.filter((s) => s.kind === "gap").map((s) => s.truthStart),
    markers: [],
    barDuration: cursor,
    truthDuration,
  };
  timeline.markers = scenario.events.map((event) => ({
    type: event.type,
    label: EVENT_LABELS_FR[event.type],
    truthTime: event.time,
    barPosition: truthToBar(timeline, event.time),
  }));
  return timeline;
}

function pushPlay(spans: Span[], truthStart: number, truthEnd: number) {
  if (truthEnd <= truthStart) return;
  const last = spans[spans.length - 1];
  if (last && last.kind === "play" && last.truthEnd === truthStart) {
    last.truthEnd = truthEnd;
    return;
  }
  spans.push({ kind: "play", truthStart, truthEnd });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truthToBar(timeline: PresentationTimeline, truthTime: number): number {
  const t = clamp(truthTime, 0, timeline.truthDuration);
  for (const segment of timeline.segments) {
    if (t > segment.truthEnd) continue;
    if (segment.kind === "play") return segment.barStart + Math.max(0, t - segment.truthStart);
    return t >= segment.truthEnd ? segment.barEnd : segment.barStart;
  }
  return timeline.barDuration;
}

/** A position on the bar inside a gap lands after the gap: there is nothing to show in between. */
export function barToTruth(timeline: PresentationTimeline, barPosition: number): number {
  const b = clamp(barPosition, 0, timeline.barDuration);
  for (const segment of timeline.segments) {
    if (b > segment.barEnd) continue;
    return segment.kind === "play" ? segment.truthStart + (b - segment.barStart) : segment.truthEnd;
  }
  return timeline.truthDuration;
}

export function snapOutOfGap(timeline: PresentationTimeline, truthTime: number): number {
  for (const segment of timeline.segments) {
    if (segment.kind === "gap" && truthTime > segment.truthStart && truthTime < segment.truthEnd) return segment.truthEnd;
  }
  return truthTime;
}

export function gapAtHold(timeline: PresentationTimeline, holdTime: number): PresentationSegment | null {
  return timeline.segments.find((s) => s.kind === "gap" && Math.abs(s.truthStart - holdTime) < 0.01) ?? null;
}

export function currentMarker(timeline: PresentationTimeline, truthTime: number): TimelineMarker | null {
  let current: TimelineMarker | null = null;
  for (const marker of timeline.markers) {
    if (marker.truthTime > truthTime) break;
    current = marker;
  }
  return current;
}

/** Relative case time. The scenario only carries seconds since its first event, so the clock stays relative. */
export function formatElapsed(truthSeconds: number): string {
  const s = Math.max(0, Math.floor(truthSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `T+${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `T+${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `T+${seconds} s`;
}
