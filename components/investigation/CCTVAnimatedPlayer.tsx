"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CCTVSequenceDescriptor } from "@/lib/art/cctv-sequence";
import { QUALITY_BRIGHTNESS, QUALITY_NOISE, CCTV_QUALITY_LABEL } from "@/lib/art/cctv-renderer";
import { pickRange } from "@/lib/art/hash";

const WIDTH = 320;
const HEIGHT = 180;
const FLOOR_Y = HEIGHT - 10;

/** Builds a static, deterministic grain texture once per `grainSeed` — a
 * cosmetic-only rendering detail (req. 31), cheap enough to build eagerly
 * and then just `drawImage` every frame instead of recomputing noise per
 * frame (req. 28 — no per-frame CPU cost beyond a single blit). */
function buildNoiseTexture(grainSeed: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const n = document.createElement("canvas");
  n.width = WIDTH;
  n.height = HEIGHT;
  const nctx = n.getContext("2d");
  if (!nctx) return null;
  const img = nctx.createImageData(WIDTH, HEIGHT);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = pickRange(`${grainSeed}:${i}`, 0, 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  return n;
}

/** Cosmetic-only silhouette body draw — same visual language as the static
 * SVG viewer (`buildCCTVFrameSvg`), just parameterized by a live x/scale
 * instead of a fixed position. `identifiable` gates blur/opacity exactly as
 * the static frame does; it never draws a name, initials, or any per-person
 * detail (req. 5). */
function drawActor(ctx: CanvasRenderingContext2D, x: number, lane: 0 | 1 | 2, heightBucket: 0 | 1 | 2, gaitSeed: number, tSeconds: number, identifiable: boolean) {
  const scale = 0.7 + lane * 0.18;
  const height = (60 + heightBucket * 15) * scale;
  const headR = height * 0.14;
  const y = FLOOR_Y - height;
  // Cosmetic walking bob — deterministic phase per actor, never affects
  // timing/visibility (req. 31).
  const bob = Math.sin(tSeconds * 3 + gaitSeed) * 1.5;

  ctx.save();
  ctx.fillStyle = "#0a0a0a";
  ctx.globalAlpha = identifiable ? 0.82 : 0.42;
  if (!identifiable) ctx.filter = "blur(2.5px)";

  ctx.beginPath();
  ctx.arc(x, y + bob, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x - headR * 1.4, y + headR + bob);
  ctx.quadraticCurveTo(x, y + height * 0.55 + bob, x + headR * 1.4, y + headR + bob);
  ctx.lineTo(x + headR * 1.6, FLOOR_Y);
  ctx.lineTo(x - headR * 1.6, FLOOR_Y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(clamped / 3600) % 24;
  const mm = Math.floor((clamped % 3600) / 60) % 60;
  const ss = clamped % 60;
  return [hh, mm, ss].map((v) => v.toString().padStart(2, "0")).join(":");
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

/**
 * Canvas 2D playable CCTV renderer (Phase 3). Every frame is drawn as a pure
 * function of `sequence` + the current playhead — seeking never mutates
 * anything and always reproduces the exact same visual state, matching the
 * descriptor's own determinism (req. 32/36).
 */
export function CCTVAnimatedPlayer({ sequence }: { sequence: CCTVSequenceDescriptor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameWallClock = useRef<number | null>(null);
  const [currentSecond, setCurrentSecond] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  const noiseCanvas = useMemo(() => buildNoiseTexture(sequence.grainSeed), [sequence.grainSeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Simulated low frame rate: the playhead itself still advances smoothly
    // (so play/pause/seek stay responsive), but the drawn actor pose is
    // quantized to `sequence.fps` steps — cosmetic only (req. 15).
    const stepSeconds = 1 / sequence.fps;
    const displaySecond = Math.floor(currentSecond / stepSeconds) * stepSeconds;

    const brightness = QUALITY_BRIGHTNESS[sequence.quality];
    ctx.fillStyle = `hsl(0, 0%, ${brightness}%)`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(WIDTH, FLOOR_Y);
    ctx.stroke();

    for (const actor of sequence.actors) {
      if (displaySecond < actor.visibleFrom) continue;
      if (actor.visibleUntil !== null && displaySecond > actor.visibleUntil) continue;
      const windowEnd = actor.visibleUntil ?? sequence.durationSeconds;
      const progress = windowEnd > actor.visibleFrom ? (displaySecond - actor.visibleFrom) / (windowEnd - actor.visibleFrom) : 0;
      const x = lerp((actor.path.xEntry / 100) * WIDTH, (actor.path.xExit / 100) * WIDTH, Math.min(1, Math.max(0, progress)));
      drawActor(ctx, x, actor.path.lane, actor.appearance.heightBucket, actor.appearance.gaitSeed, displaySecond, actor.identifiable);
    }

    // Grain/noise overlay — a static deterministic texture, cheap to redraw,
    // its opacity fixed by quality tier (never by playback state).
    if (noiseCanvas) {
      ctx.save();
      ctx.globalAlpha = QUALITY_NOISE[sequence.quality];
      ctx.drawImage(noiseCanvas, 0, 0);
      ctx.restore();
    }

    // Scanlines.
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = "#ffffff";
    for (let y = 0; y < HEIGHT; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "#3a2020";
    ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);

    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "#c9a23d";
    ctx.globalAlpha = 0.85;
    ctx.textAlign = "left";
    ctx.fillText(sequence.cameraId, 8, 16);

    ctx.textAlign = "right";
    ctx.font = "8px ui-monospace, monospace";
    ctx.globalAlpha = 0.75;
    ctx.fillText(CCTV_QUALITY_LABEL[sequence.quality], WIDTH - 8, 28);

    ctx.textAlign = "left";
    ctx.font = "9px ui-monospace, monospace";
    ctx.globalAlpha = 0.85;
    ctx.fillText(formatClock(sequence.clockStartSecond + displaySecond), 8, HEIGHT - 8);

    ctx.beginPath();
    ctx.fillStyle = "#d33";
    ctx.globalAlpha = 0.9;
    ctx.arc(WIDTH - 16, 12, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("REC", WIDTH - 30, 16);
    ctx.globalAlpha = 1;
  }, [currentSecond, sequence, noiseCanvas]);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameWallClock.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = (now: number) => {
      if (lastFrameWallClock.current === null) lastFrameWallClock.current = now;
      const deltaSeconds = ((now - lastFrameWallClock.current) / 1000) * rate;
      lastFrameWallClock.current = now;
      setCurrentSecond((prev) => {
        const next = prev + deltaSeconds;
        if (next >= sequence.durationSeconds) {
          setIsPlaying(false);
          return sequence.durationSeconds;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying, rate, sequence.durationSeconds]);

  // Stop the animation loop on unmount, regardless of play state.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const togglePlay = () => {
    if (currentSecond >= sequence.durationSeconds) setCurrentSecond(0);
    setIsPlaying((p) => !p);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="w-full border border-border-strong"
        role="img"
        aria-label={`Séquence de vidéosurveillance ${sequence.cameraId}`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Mettre en pause" : "Lire la séquence"}
          className="btn !px-2 !py-1 !text-[10px]"
        >
          {isPlaying ? "⏸ PAUSE" : currentSecond >= sequence.durationSeconds ? "↺ REJOUER" : "▶ LECTURE"}
        </button>
        <input
          type="range"
          min={0}
          max={sequence.durationSeconds}
          step={0.1}
          value={currentSecond}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentSecond(Number(e.target.value));
          }}
          aria-label="Position dans la séquence"
          className="h-1 flex-1 accent-danger"
        />
        <span className="font-data text-[10px] text-muted">
          {formatElapsed(currentSecond)} / {formatElapsed(sequence.durationSeconds)}
        </span>
        <button
          type="button"
          onClick={() => setRate((r) => (r === 1 ? 2 : r === 2 ? 0.5 : 1))}
          aria-label="Changer la vitesse de lecture"
          className="btn btn-ghost !px-2 !py-1 !text-[10px]"
        >
          {rate}×
        </button>
      </div>
    </div>
  );
}
