"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CCTVSequenceDescriptor, CCTVEnvironmentKind } from "@/lib/art/cctv-sequence";
import { QUALITY_BRIGHTNESS, QUALITY_NOISE, CCTV_QUALITY_LABEL } from "@/lib/art/cctv-renderer";
import { pickRange } from "@/lib/art/hash";
import { computeActorPose, solveTwoBoneIK, type CCTVActorPose } from "@/lib/art/cctv-actor-pose";

const WIDTH = 320;
const HEIGHT = 180;
const FLOOR_Y = 150;
const HORIZON_Y = 55;

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

/**
 * Generic procedural CCTV backdrop per `CCTVEnvironmentKind` — cosmetic
 * structural shapes only (walls, a doorway, ground markings, generic
 * building silhouettes). Never draws a person, vehicle, sign, weapon, bag,
 * or any case-specific object (req. 7/12) — every call site here only ever
 * fills/strokes plain geometric primitives at low opacity.
 */
function drawEnvironment(ctx: CanvasRenderingContext2D, kind: CCTVEnvironmentKind, seed: string) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";

  if (kind === "corridor") {
    const vanishX = WIDTH / 2 + pickRange(`${seed}:vanish`, -18, 18);
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(vanishX - 34, HORIZON_Y);
    ctx.lineTo(vanishX - 34, FLOOR_Y + 24);
    ctx.lineTo(0, HEIGHT);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(WIDTH, 0);
    ctx.lineTo(vanishX + 34, HORIZON_Y);
    ctx.lineTo(vanishX + 34, FLOOR_Y + 24);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.25;
    const doorW = 24;
    const doorH = 44;
    ctx.fillRect(vanishX - doorW / 2, FLOOR_Y - doorH, doorW, doorH);

    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 1;
    for (const fx of [0.15, 0.5, 0.85]) {
      ctx.beginPath();
      ctx.moveTo(WIDTH * fx, FLOOR_Y + 24);
      ctx.lineTo(vanishX, HORIZON_Y + 26);
      ctx.stroke();
    }
  } else if (kind === "parking") {
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = 36 + i * 74 + pickRange(`${seed}:stripe${i}`, -6, 6);
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y + 20);
      ctx.lineTo(x - 8, HORIZON_Y + 34);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.28;
    const pillarX = pickRange(`${seed}:pillar`, 70, WIDTH - 70);
    ctx.fillRect(pillarX - 7, HORIZON_Y + 8, 14, FLOOR_Y - HORIZON_Y + 22);
  } else if (kind === "street") {
    ctx.globalAlpha = 0.16;
    let x = pickRange(`${seed}:bstart`, -10, 10);
    let i = 0;
    while (x < WIDTH) {
      const w = pickRange(`${seed}:bw${i}`, 28, 58);
      const h = pickRange(`${seed}:bh${i}`, 18, 42);
      ctx.fillRect(x, HORIZON_Y - h + 22, w, h);
      x += w + pickRange(`${seed}:bg${i}`, 3, 10);
      i++;
    }
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y + 14);
    ctx.lineTo(WIDTH, FLOOR_Y + 14);
    ctx.stroke();
  } else if (kind === "shop") {
    ctx.globalAlpha = 0.22;
    const counterX = pickRange(`${seed}:counter`, 16, WIDTH - 120);
    ctx.fillRect(counterX, FLOOR_Y - 16, 96, 16);
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.strokeRect(10 + i * 9, HORIZON_Y + 6, 6, FLOOR_Y - HORIZON_Y - 10);
    }
  }
  // "generic" draws nothing extra — the plain quality-tinted background is
  // the safe fallback when a location's type doesn't map to a specific kind.

  ctx.restore();
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, x: number, figureHeightPx: number) {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, FLOOR_Y, figureHeightPx * 0.24, figureHeightPx * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws one articulated human silhouette via simple two-bone IK for the
 * legs (so the feet always land on `FLOOR_Y` regardless of stride, for
 * grounding) and single-segment swinging arms. `identifiable` gates
 * blur/opacity exactly as the previous static frame did (req. 11) — an
 * anonymous actor gets a generic blurred body and NOTHING else: no face, no
 * hairstyle, no clothing detail tied to a hidden identity (req. 11/12).
 * Every proportion/angle here is derived only from `pose`, itself a pure
 * function of the sequence descriptor's own path/gait data (req. 13) — no
 * randomness, no invented gesture, no held object.
 */
function drawHumanFigure(ctx: CanvasRenderingContext2D, pose: CCTVActorPose, heightBucket: 0 | 1 | 2) {
  const { x, figureHeightPx: H, facingRight, walkPhase, bob, identifiable } = pose;
  // Cosmetic-only build variance (never evidentiary) — a slightly broader
  // silhouette for a taller height bucket, purely for visual variety.
  const build = 0.92 + heightBucket * 0.08;

  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(facingRight ? 1 : -1, 1);
  ctx.fillStyle = "#0a0a0a";
  ctx.strokeStyle = "#0a0a0a";
  ctx.globalAlpha = identifiable ? 0.85 : 0.4;
  if (!identifiable) ctx.filter = "blur(2.2px)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const legLen = H * 0.5;
  const thigh = legLen * 0.53;
  const shin = legLen * 0.47;
  const torsoLen = H * 0.32;
  const headR = H * 0.11;
  const shoulderHalfW = H * 0.16 * build;
  const hipHalfW = H * 0.12 * build;

  const hipY = FLOOR_Y - legLen - bob * 0.4;
  const shoulderY = hipY - torsoLen - bob * 0.6;
  const headCenterY = shoulderY - headR * 1.35;

  const legAPhase = Math.sin(walkPhase);
  const legBPhase = Math.sin(walkPhase + Math.PI);
  const strideAmp = H * 0.17;

  ctx.lineWidth = Math.max(1.4, H * 0.085);
  for (const legPhase of [legAPhase, legBPhase]) {
    const footTargetX = legPhase * strideAmp;
    const { jointX, jointY, endX, endY } = solveTwoBoneIK(0, hipY, footTargetX, FLOOR_Y, thigh, shin);
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(jointX, jointY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  // Torso — a gently tapered quad from shoulders to hips.
  ctx.beginPath();
  ctx.moveTo(-shoulderHalfW, shoulderY);
  ctx.lineTo(shoulderHalfW, shoulderY);
  ctx.lineTo(hipHalfW, hipY);
  ctx.lineTo(-hipHalfW, hipY);
  ctx.closePath();
  ctx.fill();

  // Arms — single segment, counter-swinging opposite the same-side leg.
  const armLen = H * 0.34;
  ctx.lineWidth = Math.max(1.2, H * 0.06);
  const armAAngle = legBPhase * 0.55;
  const armBAngle = legAPhase * 0.55;
  for (const [originX, angle] of [
    [-shoulderHalfW * 0.85, armAAngle],
    [shoulderHalfW * 0.85, armBAngle],
  ] as const) {
    const handX = originX + Math.sin(angle) * armLen;
    const handY = shoulderY + Math.cos(angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(originX, shoulderY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
  }

  // Head.
  ctx.beginPath();
  ctx.arc(0, headCenterY, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
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
 * Canvas 2D playable CCTV renderer (Phase 3, visual-realism pass 3B). Every
 * frame is drawn as a pure function of `sequence` + the current playhead —
 * seeking never mutates anything and always reproduces the exact same
 * visual state (req. 32/36). Actor pose comes from `computeActorPose`
 * (`lib/art/cctv-actor-pose.ts`), which is itself a pure function of the
 * sequence's own path/gait data — this component only turns that pose into
 * pixels, it never decides where an actor is or how fast they move.
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
    const stepIndex = Math.floor(currentSecond / stepSeconds);
    const displaySecond = stepIndex * stepSeconds;
    const stepSeed = `${sequence.grainSeed}:${stepIndex}`;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Subtle per-step handheld-mount jitter — a cheap, deterministic 1px
    // wobble applied only to the scene layer (never to the text overlay, so
    // the timestamp/camera id stay reliably legible — req. 9/29).
    const jitterX = pickRange(`${stepSeed}:jx`, -1, 1);
    const jitterY = pickRange(`${stepSeed}:jy`, -1, 1);

    ctx.save();
    ctx.translate(jitterX, jitterY);

    const brightness = QUALITY_BRIGHTNESS[sequence.quality];
    ctx.fillStyle = `hsl(0, 0%, ${brightness}%)`;
    ctx.fillRect(-2, -2, WIDTH + 4, HEIGHT + 4);

    drawEnvironment(ctx, sequence.environment, `cctv-env:${sequence.evidenceId}`);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(WIDTH, FLOOR_Y);
    ctx.stroke();
    ctx.restore();

    const posesByActor = sequence.actors
      .map((actor) => ({ actor, pose: computeActorPose(actor, displaySecond, sequence.durationSeconds) }))
      .filter((p): p is { actor: (typeof sequence.actors)[number]; pose: CCTVActorPose } => p.pose !== null)
      // Farthest lane first so a nearer actor correctly draws in front.
      .sort((a, b) => a.actor.path.lane - b.actor.path.lane);

    for (const { actor, pose } of posesByActor) {
      drawGroundShadow(ctx, pose.x, pose.figureHeightPx);
      drawHumanFigure(ctx, pose, actor.appearance.heightBucket);
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

    // A couple of faint compression-artifact blocks — restrained, never
    // darkening the image overall (req. 9), just a texture detail.
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#000";
    for (let i = 0; i < 2; i++) {
      const bw = pickRange(`${stepSeed}:bw${i}`, 20, 48);
      const bh = pickRange(`${stepSeed}:bh${i}`, 10, 20);
      const bx = pickRange(`${stepSeed}:bx${i}`, 0, WIDTH - bw);
      const by = pickRange(`${stepSeed}:by${i}`, 0, HEIGHT - bh);
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.restore();

    // Restrained vignette — corners only, center (where the subject usually
    // is) stays fully legible, never an overall darkening (req. 9).
    const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.55, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.95);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(-2, -2, WIDTH + 4, HEIGHT + 4);
    ctx.restore();

    ctx.restore(); // end jittered scene layer

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
