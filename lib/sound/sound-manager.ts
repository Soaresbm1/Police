"use client";

/**
 * Sound architecture for CASELINE. Per the project brief: the game should
 * have an audio system (notifications, dossier sounds, phone, evidence,
 * ambience) with a mute option, but doesn't need real recorded assets from
 * day one. This implementation synthesizes everything via the Web Audio
 * API — short tones for UI feedback, filtered noise for ambience — no
 * files to ship, nothing to 404, behind the same `playSound(name)` /
 * `ambience.start(...)` calls a future implementation backed by real
 * `<audio>` assets would use, so swapping one in later is a drop-in change
 * to this module only.
 *
 * Volume graph: master -> { ui, ambience } -> destination. Muting is a
 * separate hard on/off on top of the graph (existing behavior, unchanged)
 * so a player who mutes never has to also remember a volume slider was
 * left up.
 */
export type SoundName = "success" | "denied" | "notify" | "click" | "alert";
export type VolumeGroup = "master" | "ui" | "ambience";
export type AmbienceKind = "office" | "rain" | "crime_scene" | "interrogation" | "cctv" | "accusation";

interface Tone {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
}

const SOUND_DEFINITIONS: Record<SoundName, Tone[]> = {
  success: [
    { freq: 660, duration: 0.09, type: "sine", gain: 0.05 },
    { freq: 880, duration: 0.13, type: "sine", gain: 0.05, delay: 0.07 },
  ],
  denied: [{ freq: 220, duration: 0.18, type: "square", gain: 0.035 }],
  notify: [{ freq: 520, duration: 0.11, type: "sine", gain: 0.045 }],
  click: [{ freq: 1000, duration: 0.02, type: "sine", gain: 0.02 }],
  alert: [
    { freq: 440, duration: 0.1, type: "triangle", gain: 0.05 },
    { freq: 440, duration: 0.1, type: "triangle", gain: 0.05, delay: 0.16 },
  ],
};

const MUTE_KEY = "caseline:sound-muted";
const MUTE_EVENT = "caseline:sound-mute-changed";
const VOLUME_KEY_PREFIX = "caseline:volume:";
const DEFAULT_VOLUME: Record<VolumeGroup, number> = { master: 0.8, ui: 0.8, ambience: 0.35 };

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let uiGain: GainNode | null = null;
let ambienceGain: GainNode | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      uiGain = audioContext.createGain();
      ambienceGain = audioContext.createGain();
      uiGain.connect(masterGain);
      ambienceGain.connect(masterGain);
      masterGain.connect(audioContext.destination);
      masterGain.gain.value = getVolume("master");
      uiGain.gain.value = getVolume("ui");
      ambienceGain.gain.value = getVolume("ambience");
    } catch {
      return null;
    }
  }
  return audioContext;
}

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Private browsing / storage disabled: sound preference just won't persist.
  }
  if (masterGain) masterGain.gain.value = muted ? 0 : getVolume("master");
  window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: muted }));
}

export function onSoundMuteChange(listener: (muted: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<boolean>).detail);
  window.addEventListener(MUTE_EVENT, handler);
  return () => window.removeEventListener(MUTE_EVENT, handler);
}

export function getVolume(group: VolumeGroup): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME[group];
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY_PREFIX + group);
    return raw !== null ? Number(raw) : DEFAULT_VOLUME[group];
  } catch {
    return DEFAULT_VOLUME[group];
  }
}

export function setVolume(group: VolumeGroup, value: number): void {
  const clamped = Math.min(1, Math.max(0, value));
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VOLUME_KEY_PREFIX + group, String(clamped));
    } catch {
      // ignore
    }
  }
  getContext(); // ensures the gain nodes exist before we touch them
  const node = group === "master" ? masterGain : group === "ui" ? uiGain : ambienceGain;
  if (node && !(group === "master" && isSoundMuted())) node.gain.value = clamped;
}

export function playSound(name: SoundName): void {
  if (isSoundMuted()) return;
  const ctx = getContext();
  if (!ctx || !uiGain) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  for (const tone of SOUND_DEFINITIONS[name]) {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.value = tone.freq;

    const startAt = ctx.currentTime + (tone.delay ?? 0);
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(tone.gain, startAt + 0.012);
    gainNode.gain.linearRampToValueAtTime(0, startAt + tone.duration);

    oscillator.connect(gainNode).connect(uiGain);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);
  }
}

// ---------------------------------------------------------------------
// Ambient bed: a police-office room tone (filtered noise + a faint
// ventilation/computer hum) or a rain texture, looping quietly behind
// gameplay. Entirely synthesized — see the module doc comment.
// ---------------------------------------------------------------------

let ambienceNodes: { stop: () => void } | null = null;
let ambienceDuckTimeout: ReturnType<typeof setTimeout> | null = null;

function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function startOffice(ctx: AudioContext, out: GainNode): () => void {
  const noise = ctx.createBufferSource();
  noise.buffer = buildNoiseBuffer(ctx);
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 380;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5;
  noise.connect(noiseFilter).connect(noiseGain).connect(out);
  noise.start();

  const hum = ctx.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 60;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.25;
  hum.connect(humGain).connect(out);
  hum.start();

  return () => {
    noise.stop();
    hum.stop();
  };
}

function startRain(ctx: AudioContext, out: GainNode): () => void {
  const noise = ctx.createBufferSource();
  noise.buffer = buildNoiseBuffer(ctx);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 2200;
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  noise.connect(filter).connect(gain).connect(out);
  noise.start();
  return () => noise.stop();
}

/** A tense, near-silent low rumble — used for the crime scene and the
 * final accusation, where the office room-tone would feel wrong. */
function startTensionBed(ctx: AudioContext, out: GainNode, freq: number, noiseGainValue: number): () => void {
  const noise = ctx.createBufferSource();
  noise.buffer = buildNoiseBuffer(ctx);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 220;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = noiseGainValue;
  noise.connect(filter).connect(noiseGain).connect(out);
  noise.start();

  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = freq;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.08;
  drone.connect(droneGain).connect(out);
  drone.start();

  return () => {
    noise.stop();
    drone.stop();
  };
}

/** A faint high-frequency hiss evoking a monitor/tape deck — used while
 * reviewing CCTV footage. */
function startCctvHiss(ctx: AudioContext, out: GainNode): () => void {
  const noise = ctx.createBufferSource();
  noise.buffer = buildNoiseBuffer(ctx);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 4200;
  const gain = ctx.createGain();
  gain.gain.value = 0.18;
  noise.connect(filter).connect(gain).connect(out);
  noise.start();
  return () => noise.stop();
}

const AMBIENCE_BUILDERS: Record<AmbienceKind, (ctx: AudioContext, out: GainNode) => () => void> = {
  office: startOffice,
  rain: startRain,
  crime_scene: (ctx, out) => startTensionBed(ctx, out, 48, 0.35),
  interrogation: (ctx, out) => startTensionBed(ctx, out, 55, 0.28),
  accusation: (ctx, out) => startTensionBed(ctx, out, 42, 0.4),
  cctv: startCctvHiss,
};

export const ambience = {
  start(kind: AmbienceKind): void {
    const ctx = getContext();
    if (!ctx || !ambienceGain) return;
    ambience.stop();
    const stopFn = AMBIENCE_BUILDERS[kind](ctx, ambienceGain);
    ambienceNodes = { stop: stopFn };
  },
  stop(): void {
    ambienceNodes?.stop();
    ambienceNodes = null;
  },
  /** Temporarily lowers the ambience bed for a tense moment (entering an
   * interrogation, the final truth reveal) and restores it afterwards. */
  duck(durationMs = 1500): void {
    if (!ambienceGain) return;
    if (ambienceDuckTimeout) clearTimeout(ambienceDuckTimeout);
    const target = getVolume("ambience");
    ambienceGain.gain.setTargetAtTime(target * 0.15, audioContext?.currentTime ?? 0, 0.2);
    ambienceDuckTimeout = setTimeout(() => {
      ambienceGain?.gain.setTargetAtTime(target, audioContext?.currentTime ?? 0, 0.8);
    }, durationMs);
  },
};
