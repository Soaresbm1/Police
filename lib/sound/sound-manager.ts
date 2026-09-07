"use client";

/**
 * Sound architecture for CASELINE. Per the project brief (§33): the game
 * should have an audio system (notifications, dossier sounds, phone,
 * evidence, ambience) with a mute option, but doesn't need real recorded
 * assets from day one. This implementation synthesizes short, deliberately
 * quiet tones via the Web Audio API — no files to ship, nothing to 404 —
 * behind the same `playSound(name)` call a future implementation backed by
 * real `<audio>` assets would use, so swapping one in later is a drop-in
 * change to this module only.
 */
export type SoundName = "success" | "denied" | "notify" | "click" | "alert";

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

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContextClass();
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
  window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: muted }));
}

export function onSoundMuteChange(listener: (muted: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<boolean>).detail);
  window.addEventListener(MUTE_EVENT, handler);
  return () => window.removeEventListener(MUTE_EVENT, handler);
}

export function playSound(name: SoundName): void {
  if (isSoundMuted()) return;
  const ctx = getContext();
  if (!ctx) return;
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

    oscillator.connect(gainNode).connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);
  }
}
