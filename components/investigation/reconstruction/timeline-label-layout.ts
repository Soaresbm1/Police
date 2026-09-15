import type { PresentationTimeline } from "@/lib/game-engine/reconstruction/reconstruction-presentation";

/**
 * Placement of the semantic event labels under the reconstruction timeline. Pure and deterministic: the same markers
 * and the same container width always give the same rows and positions.
 *
 * Labels are placed in timeline order, each on the first of two rows whose previous label ends at least LABEL_GAP_PX
 * before this one starts, using the label's own width. When neither row has room the text is left out (row null).
 * The marker itself keeps the event name as its accessible name and tooltip, so the event never leaves the timeline.
 */

/** Conservative advance per character of the 10 px uppercase data font (measured ≈6.3 px on Preview). */
export const LABEL_CHAR_WIDTH_PX = 7;
export const LABEL_GAP_PX = 8;
export const LABEL_ROW_COUNT = 2;

export interface TimelineLabelInput {
  key: string;
  text: string;
  /** Marker position along the bar, 0–100. */
  percent: number;
}

export interface TimelineLabelPlacement {
  key: string;
  text: string;
  /** Row 0 or 1; null when both rows are occupied there and only the marker is shown. */
  row: number | null;
  leftPx: number;
  widthPx: number;
}

export function estimateLabelWidth(text: string): number {
  return [...text].length * LABEL_CHAR_WIDTH_PX;
}

export function timelineLabelInputs(timeline: PresentationTimeline): TimelineLabelInput[] {
  return timeline.markers.map((marker, index) => ({
    key: `${marker.type}-${index}`,
    text: marker.label,
    percent: timeline.barDuration > 0 ? (marker.barPosition / timeline.barDuration) * 100 : 0,
  }));
}

export function layoutTimelineLabels(labels: readonly TimelineLabelInput[], containerWidthPx: number): TimelineLabelPlacement[] {
  const placements: TimelineLabelPlacement[] = labels.map(({ key, text }) => ({ key, text, row: null, leftPx: 0, widthPx: 0 }));
  if (!(containerWidthPx > 0)) return placements;

  const rowEnds = Array.from({ length: LABEL_ROW_COUNT }, () => -Infinity);
  const order = labels.map((_, index) => index).sort((a, b) => labels[a].percent - labels[b].percent || a - b);
  for (const index of order) {
    const { text, percent } = labels[index];
    const widthPx = Math.min(estimateLabelWidth(text), containerWidthPx);
    const centerPx = (Math.min(100, Math.max(0, percent)) / 100) * containerWidthPx;
    // Centred on its marker, but never past either end of the timeline.
    const leftPx = Math.round(Math.min(containerWidthPx - widthPx, Math.max(0, centerPx - widthPx / 2)));
    const row = rowEnds.findIndex((end) => leftPx >= end + LABEL_GAP_PX);
    placements[index] = { ...placements[index], row: row === -1 ? null : row, leftPx, widthPx };
    if (row !== -1) rowEnds[row] = leftPx + widthPx;
  }
  return placements;
}
