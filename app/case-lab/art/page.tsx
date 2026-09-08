import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed, isValidCaseSeed } from "@/lib/game-engine/random/rng";
import type { Difficulty } from "@/lib/game-engine/types/case";
import { fullName } from "@/lib/game-engine/types/person";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildCharacterVisualDescriptor, buildCrimeSceneVisualDescriptor } from "@/lib/art/visual-manifest";
import { buildCharacterPortraitPrompt, CHARACTER_PROMPT_VERSION } from "@/lib/art/generation/character-prompt";
import { buildCrimeSceneEnvironmentPrompt, CRIME_SCENE_PROMPT_VERSION } from "@/lib/art/generation/crime-scene-prompt";
import { hashDescriptor } from "@/lib/art/asset-cache";
import * as assetStore from "@/lib/art/generation/asset-store";
import { CHARACTER_PORTRAIT_GENERATION_VERSION, CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME } from "@/lib/art/generation/asset-kinds";
import { isCloudflareConfigured } from "@/lib/art/generation/providers/cloudflare-provider";
import type { GeneratedAssetRecord } from "@/lib/art/generation/types";
import { triggerAssetGenerationAction } from "./actions";

export const dynamic = "force-dynamic";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

const main: CSSProperties = { fontFamily: "monospace", padding: 24, background: "#0b0e14", color: "#d6deeb", minHeight: "100vh" };
const table: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 8, fontSize: 12 };
const th: CSSProperties = { textAlign: "left", borderBottom: "1px solid #30363d", padding: "4px 8px", color: "#8a94a6" };
const td: CSSProperties = { borderBottom: "1px solid #1c2128", padding: "4px 8px" };
const badge = (color: string): CSSProperties => ({ color, border: `1px solid ${color}`, padding: "1px 6px", fontSize: 10 });

const STATUS_COLOR: Record<string, string> = { missing: "#8a94a6", queued: "#c9a23d", generating: "#c9a23d", ready: "#6c9c72", failed: "#b8493e" };

interface AssetRow {
  assetKind: "character_portrait" | "crime_scene_environment";
  refLabel: string;
  descriptorHash: string;
  generationVersion: number;
  promptVersion: number;
  prompt: string;
  seed: string;
  record: GeneratedAssetRecord | null;
}

export default async function ArtInspectorPage({ searchParams }: { searchParams: Promise<{ seed?: string; difficulty?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const difficulty: Difficulty = DIFFICULTIES.includes(params.difficulty as Difficulty) ? (params.difficulty as Difficulty) : "investigator";
  const seed = params.seed && isValidCaseSeed(params.seed) ? params.seed : generateCaseSeed();

  const truth = generateCase(seed, { difficulty });
  const identity = await getCurrentIdentity();
  const supabaseReady = isSupabaseConfigured();
  const canQuery = supabaseReady && identity.authenticated;

  // Pilot scope: victim + suspects (includes the culprit) + witnesses
  // (excludes plain bystanders/red herrings) — the same set the real
  // pipeline is meant to be triggered for, never every person in the case.
  const importantPeople = truth.people.filter(
    (p) => p.id === truth.victimId || truth.suspectIds.includes(p.id) || (p.roles.includes("witness") && !truth.redHerringPersonIds.includes(p.id)),
  );

  const rows: AssetRow[] = [];

  for (const person of importantPeople) {
    const descriptor = buildCharacterVisualDescriptor(person);
    const descriptorHash = hashDescriptor(descriptor);
    const record = canQuery
      ? await assetStore.findAssetRecord(identity.userId, descriptorHash, CHARACTER_PORTRAIT_GENERATION_VERSION, ACTIVE_PROVIDER_NAME)
      : null;
    rows.push({
      assetKind: "character_portrait",
      refLabel: `${fullName(person)} (${person.id === truth.victimId ? "victime" : truth.suspectIds.includes(person.id) ? "suspect" : "témoin"})`,
      descriptorHash,
      generationVersion: CHARACTER_PORTRAIT_GENERATION_VERSION,
      promptVersion: CHARACTER_PROMPT_VERSION,
      prompt: buildCharacterPortraitPrompt(descriptor),
      seed: descriptor.seed,
      record,
    });
  }

  const crimeLocation = truth.locations.find((l) => l.id === truth.crimeLocationId);
  if (crimeLocation) {
    const sceneDescriptor = buildCrimeSceneVisualDescriptor(crimeLocation, truth.crimeTimestamp);
    const descriptorHash = hashDescriptor(sceneDescriptor);
    const record = canQuery
      ? await assetStore.findAssetRecord(identity.userId, descriptorHash, CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME)
      : null;
    rows.push({
      assetKind: "crime_scene_environment",
      refLabel: `Scène de crime — ${crimeLocation.name}`,
      descriptorHash,
      generationVersion: CRIME_SCENE_GENERATION_VERSION,
      promptVersion: CRIME_SCENE_PROMPT_VERSION,
      prompt: buildCrimeSceneEnvironmentPrompt(sceneDescriptor),
      seed: sceneDescriptor.seed,
      record,
    });
  }

  const readyCount = rows.filter((r) => r.record?.status === "ready").length;
  const failedCount = rows.filter((r) => r.record?.status === "failed").length;
  const attemptedCount = rows.filter((r) => r.record && r.record.attemptCount > 0).length;

  return (
    <main style={main}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>CASE LAB — Generated Art Inspector</h1>
      <p style={{ color: "#8a94a6", marginBottom: 16 }}>
        Dev-only. Never accessible in production. Shows the generated-art pilot scope (victim, suspects, witnesses, crime
        scene) for one case and lets you manually trigger generation for a single asset — nothing here ever generates
        automatically.
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input name="seed" defaultValue={seed} placeholder="CASE-XXXXXX" style={{ padding: 6, background: "#161b22", color: "#d6deeb", border: "1px solid #30363d" }} />
        <select name="difficulty" defaultValue={difficulty} style={{ padding: 6, background: "#161b22", color: "#d6deeb", border: "1px solid #30363d" }}>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button type="submit" style={{ padding: "6px 12px", background: "#30363d", color: "#d6deeb", border: "1px solid #484f58" }}>
          Charger
        </button>
      </form>

      <p style={{ marginBottom: 4 }}>
        Cloudflare configuré : <b style={{ color: isCloudflareConfigured() ? "#6c9c72" : "#b8493e" }}>{isCloudflareConfigured() ? "oui" : "non (fallback procédural actif)"}</b>
      </p>
      <p style={{ marginBottom: 4 }}>
        Supabase configuré : <b style={{ color: supabaseReady ? "#6c9c72" : "#b8493e" }}>{supabaseReady ? "oui" : "non — persistance des assets indisponible"}</b>
        {supabaseReady && !identity.authenticated && <span style={{ color: "#c9a23d" }}> (non connecté — connectez-vous pour voir/déclencher des assets)</span>}
      </p>
      <p style={{ marginBottom: 16, color: "#8a94a6" }}>
        {rows.length} asset(s) dans le périmètre pilote — {readyCount} prêt(s), {failedCount} échoué(s), {attemptedCount} avec au moins 1 tentative.
        Chaque ligne « prêt » correspond à exactement UN appel réel au fournisseur jamais effectué plus d&apos;une fois (voir &quot;tentatives&quot;).
      </p>

      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Type</th>
            <th style={th}>Référence</th>
            <th style={th}>Statut</th>
            <th style={th}>Fournisseur</th>
            <th style={th}>Modèle</th>
            <th style={th}>Hash descripteur</th>
            <th style={th}>Version</th>
            <th style={th}>Tentatives</th>
            <th style={th}>Dimensions</th>
            <th style={th}>Fallback procédural actif</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = row.record?.status ?? "missing";
            const usingFallback = status !== "ready";
            const disabled = status === "ready" || status === "queued" || status === "generating" || !canQuery;
            return (
              <tr key={row.descriptorHash}>
                <td style={td}>{row.assetKind === "character_portrait" ? "Portrait" : "Environnement"}</td>
                <td style={td}>{row.refLabel}</td>
                <td style={td}>
                  <span style={badge(STATUS_COLOR[status])}>{status}</span>
                </td>
                <td style={td}>{row.record?.provider ?? "—"}</td>
                <td style={td}>{row.record?.providerModel ?? "—"}</td>
                <td style={td}>{row.descriptorHash.slice(0, 12)}…</td>
                <td style={td}>{row.generationVersion}</td>
                <td style={td}>{row.record?.attemptCount ?? 0}</td>
                <td style={td}>{row.record?.width && row.record?.height ? `${row.record.width}×${row.record.height}` : "—"}</td>
                <td style={td}>{usingFallback ? "oui" : "non"}</td>
                <td style={td}>
                  <form action={triggerAssetGenerationAction}>
                    <input type="hidden" name="caseSeed" value={truth.seed} />
                    <input type="hidden" name="assetKind" value={row.assetKind} />
                    <input type="hidden" name="descriptorHash" value={row.descriptorHash} />
                    <input type="hidden" name="generationVersion" value={row.generationVersion} />
                    <input type="hidden" name="promptVersion" value={row.promptVersion} />
                    <input type="hidden" name="prompt" value={row.prompt} />
                    <input type="hidden" name="seed" value={row.seed} />
                    <button
                      type="submit"
                      disabled={disabled}
                      style={{ padding: "3px 8px", background: disabled ? "#161b22" : "#30363d", color: disabled ? "#484f58" : "#d6deeb", border: "1px solid #484f58" }}
                    >
                      Générer
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", color: "#8a94a6" }}>Prompts construits pour ce cas (lecture seule, jamais envoyés sans clic)</summary>
        <ul style={{ fontSize: 11, color: "#8a94a6", marginTop: 8 }}>
          {rows.map((row) => (
            <li key={row.descriptorHash} style={{ marginBottom: 8 }}>
              <b style={{ color: "#d6deeb" }}>{row.refLabel}</b>
              <br />
              {row.prompt}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
