"use client";

import { useState } from "react";
import { ambience, playSound } from "@/lib/sound/sound-manager";
import { endCurrentCase } from "@/lib/game-session/actions";
import type { DisplayNarrativeSection } from "@/lib/game-session/narrative-reconstruction";
import { CharacterPortrait } from "./CharacterPortrait";

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

interface AccompliceScoreData {
  identified: number;
  total: number;
  roleCorrect: number;
  wronglyAccused: number;
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
  /** A coherent, deterministic reconstruction of the whole case — context,
   * motive, preparation, the crime, accomplice actions, staging/tampering,
   * aftermath, lies told, and how evidence contradicted them — never a
   * flat dump of engine fields. See lib/game-session/narrative-reconstruction.ts. */
  narrative: DisplayNarrativeSection[];
  accompliceScore: AccompliceScoreData | null;
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
            {data.accompliceScore && (
              <>
                <Stat
                  label="Complices identifiés"
                  value={`${data.accompliceScore.identified} / ${data.accompliceScore.total}`}
                  good={data.accompliceScore.total === 0 || data.accompliceScore.identified === data.accompliceScore.total}
                />
                <Stat
                  label="Personnes accusées à tort"
                  value={String(data.accompliceScore.wronglyAccused)}
                  good={data.accompliceScore.wronglyAccused === 0}
                />
              </>
            )}
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
            <div className="relative flex flex-col gap-5 border-l border-border-strong pl-6">
              {data.narrative.map((section) => (
                <div key={section.heading} className="relative">
                  <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full border-2 border-accent-strong bg-background-deep" />
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <p className="field-label !mb-0">{section.heading}</p>
                    {section.timeLabel && <span className="font-data text-[10px] text-accent-strong">{section.timeLabel}</span>}
                    {section.locationName && (
                      <span className="border border-border-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        📍 {section.locationName}
                      </span>
                    )}
                  </div>
                  {section.people.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {section.people.map((p) => (
                        <span key={p.id} className="flex items-center gap-1.5 border border-border-strong bg-surface-sunken py-0.5 pl-0.5 pr-2">
                          <CharacterPortrait seed={p.avatarSeed} name={p.name} size={22} generatedSrc={p.generatedSrc} />
                          <span className="text-[11px] text-foreground">{p.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="font-document flex flex-col gap-1 text-sm text-foreground">
                    {section.paragraphs.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
          <form action={endCurrentCase}>
            <button type="submit" className="btn btn-primary mt-4 !px-8">
              Retour au commissariat
            </button>
          </form>
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
