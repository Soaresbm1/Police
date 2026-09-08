"use client";

import Link from "next/link";
import { useState } from "react";
import { ambience, playSound } from "@/lib/sound/sound-manager";

const GRADE_COLOR: Record<string, string> = {
  S: "text-accent-strong",
  A: "text-success",
  B: "text-link",
  C: "text-warning",
  D: "text-danger",
};

interface StatRow {
  label: string;
  value: string;
  good?: boolean;
}

interface TimelineEntry {
  id: string;
  timeLabel: string;
  description: string;
  isCrimeEvent: boolean;
}

export interface TruthRevealData {
  caseRef: string;
  grade: string;
  overallPercent: number;
  culpritCorrect: boolean;
  accusedName: string;
  motiveCorrect: boolean;
  methodCorrect: boolean;
  stats: StatRow[];
  realVictimName: string;
  realCulpritName: string;
  motiveLabel: string;
  motiveDescription: string;
  method: string;
  timeline: TimelineEntry[];
}

const STEP_COUNT = 5;

export function TruthRevealSequence({ data }: { data: TruthRevealData }) {
  const [step, setStep] = useState(0);

  const advance = () => {
    playSound("click");
    setStep((s) => {
      const next = Math.min(STEP_COUNT - 1, s + 1);
      // The two most dramatic beats — the grade reveal and the truth
      // reveal — get a moment of near-silence from the ambient bed first.
      if (next === 1 || next === 3) ambience.duck(2500);
      return next;
    });
  };
  const skipToEnd = () => {
    playSound("click");
    setStep(STEP_COUNT - 1);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span key={i} className={`h-1 w-8 ${i <= step ? "bg-accent" : "bg-border"}`} />
          ))}
        </div>
        {step < STEP_COUNT - 1 && (
          <button type="button" onClick={skipToEnd} className="font-data text-[11px] uppercase tracking-widest text-muted hover:text-foreground">
            Tout afficher →
          </button>
        )}
      </div>

      {step === 0 && (
        <div className="fade-up panel panel-bracketed flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-data text-xs uppercase tracking-[0.3em] text-muted">Dossier transmis</p>
          <p className="data-id text-base">{data.caseRef}</p>
          <p className="mt-2 text-lg text-foreground">Évaluation par le parquet en cours...</p>
          <button type="button" onClick={advance} className="btn btn-primary mt-4 !px-8">
            Consulter l&apos;évaluation
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="fade-up panel panel-bracketed flex flex-col items-center gap-2 p-8 text-center">
          <p className="font-data text-[10px] uppercase tracking-[0.3em] text-muted">Résultat de l&apos;accusation</p>
          <p className={`font-data text-7xl font-bold ${GRADE_COLOR[data.grade]}`}>{data.grade}</p>
          <p className="text-sm text-muted">{data.overallPercent}%</p>
          <span className={`stamp mt-2 ${data.culpritCorrect ? "stamp-blue" : "stamp-red"}`}>
            {data.culpritCorrect ? "Affaire résolue" : "Erreur judiciaire"}
          </span>
          <p className="mt-3 text-sm text-foreground">
            Vous avez désigné <span className="font-semibold">{data.accusedName}</span>.
          </p>
          <button type="button" onClick={advance} className="btn btn-primary mt-4 !px-8">
            Voir le détail
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="fade-up flex flex-col gap-4">
          <div className="panel grid gap-4 p-6 sm:grid-cols-2">
            <Stat label="Coupable désigné" value={data.accusedName} good={data.culpritCorrect} />
            <Stat label="Mobile" value={data.motiveCorrect ? "Correct" : "Incorrect"} good={data.motiveCorrect} />
            <Stat label="Méthode" value={data.methodCorrect ? "Correcte" : "Incorrecte"} good={data.methodCorrect} />
            {data.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} good={s.good} />
            ))}
          </div>
          <button type="button" onClick={advance} className="btn btn-primary self-center !px-8">
            Découvrir la vérité
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="fade-up flex flex-col gap-5">
          <div className="panel p-6">
            <div className="panel-header -mx-6 -mt-6 mb-4">
              <span className="field-label !text-accent-strong">Ce qui s&apos;est réellement passé</span>
            </div>
            <div className="font-document mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted">Victime : </span>
                <span className="text-foreground">{data.realVictimName}</span>
              </p>
              <p>
                <span className="text-muted">Coupable : </span>
                <span className="text-foreground">{data.realCulpritName}</span>
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted">Mobile : </span>
                <span className="text-foreground">
                  {data.motiveLabel} — {data.motiveDescription}
                </span>
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted">Méthode : </span>
                <span className="text-foreground">{data.method}</span>
              </p>
            </div>
            <ol className="flex flex-col gap-2 border-l border-border pl-4">
              {data.timeline.map((event) => (
                <li key={event.id} className={`relative ${event.isCrimeEvent ? "text-danger" : ""}`}>
                  <span className={`absolute -left-[21px] top-1.5 h-2 w-2 ${event.isCrimeEvent ? "bg-danger" : "bg-border-strong"}`} />
                  <span className="font-data text-xs text-muted">{event.timeLabel}</span>
                  <p className="text-sm">{event.description}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="text-center">
            <button type="button" onClick={advance} className="btn btn-primary !px-8">
              Clore le dossier
            </button>
          </div>
        </div>
      )}

      {step === STEP_COUNT - 1 && (
        <div className="fade-up panel panel-bracketed flex flex-col items-center gap-3 p-8 text-center">
          <p className={`font-data text-5xl font-bold ${GRADE_COLOR[data.grade]}`}>{data.grade}</p>
          <p className="text-sm text-muted">{data.overallPercent}% — {data.culpritCorrect ? "Affaire résolue" : "Erreur judiciaire"}</p>
          <p className="mt-2 text-sm text-foreground">Dossier {data.caseRef} classé.</p>
          <Link href="/" className="btn btn-primary mt-4 !px-8">
            Retour au commissariat
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className={`mt-1 text-sm font-medium ${good === true ? "text-success" : good === false ? "text-danger" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
