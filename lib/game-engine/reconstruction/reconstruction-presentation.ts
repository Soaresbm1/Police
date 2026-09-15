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
 * GapThresholdSeconds in Unity's ReconstructionTimelineSegmenter; validated on 2,000 generated scenarios. */
export const GAP_THRESHOLD_SECONDS = 1800;

/** Wall-clock length of the "Plus tard…" transition. Presentation only, never truth time. */
export const GAP_TRANSITION_MS = 1200;

/** Share of the in-scene playing time a compressed gap occupies on the timeline bar, so it stays visible. */
const GAP_BAR_FRACTION = 0.08;
const MIN_GAP_BAR_SECONDS = 60;

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

export function buildPresentationTimeline(scenario: ReconstructionScenario): PresentationTimeline {
  const truthDuration = scenario.durationSeconds;
  const raw = computeTimelineSegments(scenario);
  const source = raw.length > 0 ? raw : [{ start: 0, end: truthDuration, compressible: false }];

  const spans: Span[] = [];
  for (const segment of source) {
    const skipStart = segment.compressible ? movementEnd(scenario, segment.start, segment.end) : segment.end;
    if (skipStart >= segment.end) {
      pushPlay(spans, segment.start, segment.end);
      continue;
    }
    pushPlay(spans, segment.start, skipStart);
    spans.push({ kind: "gap", truthStart: skipStart, truthEnd: segment.end });
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

/**
 * The truth time by which everything visibly moving inside a gap has finished: the latest departure of any actor
 * present during it. A victim is excluded once attacked — from then on they are a body, not movement. An actor
 * who stays for the whole gap pushes this to the gap's end, so the gap simply plays: never hide movement.
 */
function movementEnd(scenario: ReconstructionScenario, start: number, end: number): number {
  const attackedAt = new Map<string, number>();
  for (const event of scenario.events) {
    if (event.type === "attack" && event.counterpartyVisualId) attackedAt.set(event.counterpartyVisualId, event.time);
  }

  let latest = start;
  for (const actor of scenario.actors) {
    const attackTime = attackedAt.get(actor.visualId);
    if (attackTime !== undefined && start >= attackTime) continue;
    if (actor.spawnTime < end && actor.despawnTime > start) latest = Math.max(latest, Math.min(actor.despawnTime, end));
  }
  return latest;
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
