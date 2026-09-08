import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { validateCase } from "@/lib/game-engine/validator/case-validator";
import { computeSolvability } from "@/lib/game-engine/validator/solvability";
import { generateCaseSeed, isValidCaseSeed } from "@/lib/game-engine/random/rng";
import { formatGameTime } from "@/lib/game-engine/types/time";
import type { Difficulty } from "@/lib/game-engine/types/case";
import { buildCaseVisualManifest } from "@/lib/art/visual-manifest";
import { crimeSceneSvgDataUri } from "@/lib/art/scene-renderer";
import { portraitService } from "@/lib/game-engine/portraits/portrait-service";

export const dynamic = "force-dynamic";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

function nameOf(people: { id: string; firstName: string; lastName: string }[], id: string): string {
  const p = people.find((person) => person.id === id);
  return p ? `${p.firstName} ${p.lastName}` : id;
}

export default async function CaseLabPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; difficulty?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const difficulty: Difficulty = DIFFICULTIES.includes(params.difficulty as Difficulty)
    ? (params.difficulty as Difficulty)
    : "investigator";
  const seed = params.seed && isValidCaseSeed(params.seed) ? params.seed : generateCaseSeed();

  let truth;
  let generationError: string | null = null;
  try {
    truth = generateCase(seed, { difficulty });
  } catch (err) {
    generationError = err instanceof Error ? err.message : String(err);
  }

  const validation = truth ? validateCase(truth) : null;
  const solvability = truth ? computeSolvability(truth) : null;
  const visualManifest = truth ? buildCaseVisualManifest(truth) : null;

  return (
    <main style={{ fontFamily: "monospace", padding: 24, background: "#0b0e14", color: "#d6deeb", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>CASE LAB — outil de développement</h1>
      <p style={{ color: "#8a94a6", marginBottom: 16 }}>
        Jamais accessible en production. Affiche la CaseTruth complète (vérité cachée) pour déboguer le moteur.
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        <input
          name="seed"
          defaultValue={seed}
          placeholder="CASE-XXXXXX"
          style={{ padding: 6, background: "#161b22", color: "#d6deeb", border: "1px solid #30363d" }}
        />
        <select
          name="difficulty"
          defaultValue={difficulty}
          style={{ padding: 6, background: "#161b22", color: "#d6deeb", border: "1px solid #30363d" }}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button type="submit" style={{ padding: "6px 12px", background: "#1f6feb", color: "white", border: "none" }}>
          Charger
        </button>
        <a
          href={`/case-lab?seed=${generateCaseSeed()}&difficulty=${difficulty}`}
          style={{ padding: "6px 12px", background: "#30363d", color: "#d6deeb", textDecoration: "none" }}
        >
          Generate New Case
        </a>
      </form>

      {generationError && (
        <div style={{ background: "#3d1f1f", border: "1px solid #ff5555", padding: 12, marginBottom: 16 }}>
          <strong>Échec de génération :</strong> {generationError}
        </div>
      )}

      {truth && validation && solvability && (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Résumé</h2>
            <table style={table}>
              <tbody>
                <tr>
                  <td style={td}>Seed</td>
                  <td style={td}>{truth.seed}</td>
                </tr>
                <tr>
                  <td style={td}>Difficulté</td>
                  <td style={td}>{truth.difficulty}</td>
                </tr>
                <tr>
                  <td style={td}>Archétype</td>
                  <td style={td}>{truth.archetype}</td>
                </tr>
                <tr>
                  <td style={td}>Victime</td>
                  <td style={td}>{nameOf(truth.people, truth.victimId)}</td>
                </tr>
                <tr>
                  <td style={td}>Coupable</td>
                  <td style={td}>{nameOf(truth.people, truth.culpritId)}</td>
                </tr>
                <tr>
                  <td style={td}>Mobile</td>
                  <td style={td}>
                    {truth.motive.type} (force {truth.motive.strength.toFixed(2)}) — {truth.motive.description}
                  </td>
                </tr>
                <tr>
                  <td style={td}>Méthode / Arme</td>
                  <td style={td}>
                    {truth.method} / {truth.weapon}
                  </td>
                </tr>
                <tr>
                  <td style={td}>Prémédité</td>
                  <td style={td}>{truth.premeditated ? "oui" : "non"}</td>
                </tr>
                <tr>
                  <td style={td}>Lieu / Heure du crime</td>
                  <td style={td}>
                    {truth.crimeLocationId} — {formatGameTime(truth.crimeTimestamp)}
                  </td>
                </tr>
                <tr>
                  <td style={td}>Validité</td>
                  <td style={{ ...td, color: validation.valid ? "#7ee787" : "#ff7b72" }}>
                    {validation.valid ? "VALID" : "INVALID"}
                  </td>
                </tr>
                <tr>
                  <td style={td}>Score de solvabilité</td>
                  <td style={td}>
                    {solvability.score.toFixed(2)} ({solvability.independentChannels.join(", ") || "aucune chaîne"})
                  </td>
                </tr>
                <tr>
                  <td style={td}>Score de difficulté</td>
                  <td style={td}>{validation.difficultyScore.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {validation.errors.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ ...sectionTitle, color: "#ff7b72" }}>Erreurs ({validation.errors.length})</h2>
              <ul>
                {validation.errors.map((e, i) => (
                  <li key={i} style={{ color: "#ff7b72" }}>
                    {e}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {validation.warnings.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ ...sectionTitle, color: "#e3b341" }}>Avertissements ({validation.warnings.length})</h2>
              <ul>
                {validation.warnings.map((w, i) => (
                  <li key={i} style={{ color: "#e3b341" }}>
                    {w}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Complices ({truth.accomplices.length})</h2>
            {truth.accomplices.length === 0 ? (
              <p style={{ color: "#8a94a6" }}>Aucun.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Personne</th>
                    <th style={th}>Rôle</th>
                    <th style={th}>Connaît le plan ?</th>
                    <th style={th}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {truth.accomplices.map((a) => (
                    <tr key={a.personId}>
                      <td style={td}>{nameOf(truth.people, a.personId)}</td>
                      <td style={td}>{a.role}</td>
                      <td style={td}>{a.knowsFullPlan ? "oui" : "non"}</td>
                      <td style={td}>{a.involvementDescription}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Mise en scène</h2>
            <p>
              {truth.staging.staged ? (
                <>
                  <strong>{truth.staging.type}</strong> — {truth.staging.description} (tells :{" "}
                  {truth.staging.tellEvidenceIds.join(", ")})
                </>
              ) : (
                "Aucune."
              )}
            </p>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Manipulations de preuves ({truth.tamperingEvents.length})</h2>
            {truth.tamperingEvents.length === 0 ? (
              <p style={{ color: "#8a94a6" }}>Aucune.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Heure</th>
                    <th style={th}>Auteur</th>
                    <th style={th}>Action</th>
                    <th style={th}>Cible supprimée</th>
                    <th style={th}>Trace secondaire</th>
                    <th style={th}>Risque</th>
                  </tr>
                </thead>
                <tbody>
                  {truth.tamperingEvents.map((t) => (
                    <tr key={t.id}>
                      <td style={td}>{formatGameTime(t.timestamp)}</td>
                      <td style={td}>{nameOf(truth.people, t.actorId)}</td>
                      <td style={td}>{t.action}</td>
                      <td style={td}>{t.targetEvidenceId ?? "—"}</td>
                      <td style={td}>{t.secondaryTraceEvidenceId}</td>
                      <td style={td}>{t.riskOfTrace.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Fausse confession</h2>
            {truth.falseConfession ? (
              <table style={table}>
                <tbody>
                  <tr>
                    <td style={td}>Confesseur</td>
                    <td style={td}>{nameOf(truth.people, truth.falseConfession.personId)}</td>
                  </tr>
                  <tr>
                    <td style={td}>Raison</td>
                    <td style={td}>{truth.falseConfession.reason}</td>
                  </tr>
                  <tr>
                    <td style={td}>Reconstruction déclarée</td>
                    <td style={td}>{truth.falseConfession.claimedReconstruction}</td>
                  </tr>
                  <tr>
                    <td style={td}>Méthode / horaire déclarés</td>
                    <td style={td}>
                      {truth.falseConfession.claimedMethod} — {formatGameTime(truth.falseConfession.claimedTimingStart)} à{" "}
                      {formatGameTime(truth.falseConfession.claimedTimingEnd)}
                    </td>
                  </tr>
                  <tr>
                    <td style={td}>Mobile déclaré</td>
                    <td style={td}>{truth.falseConfession.claimedMotiveText}</td>
                  </tr>
                  <tr>
                    <td style={{ ...td, color: "#e3b341" }}>Incohérence objective</td>
                    <td style={{ ...td, color: "#e3b341" }}>{truth.falseConfession.conflictingDetail}</td>
                  </tr>
                  <tr>
                    <td style={td}>Preuves de réfutation</td>
                    <td style={td}>{truth.falseConfession.disprovingEvidenceIds.join(", ")}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p style={{ color: "#8a94a6" }}>Aucune.</p>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Ressources partagées ({truth.sharedResources.length})</h2>
            {truth.sharedResources.length === 0 ? (
              <p style={{ color: "#8a94a6" }}>Aucune.</p>
            ) : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>Propriétaires</th>
                    <th style={th}>Libellé</th>
                  </tr>
                </thead>
                <tbody>
                  {truth.sharedResources.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{r.kind}</td>
                      <td style={td}>{r.ownerPersonIds.map((id) => nameOf(truth.people, id)).join(", ")}</td>
                      <td style={td}>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Mobiles par suspect</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Suspect</th>
                  <th style={th}>Mobiles</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(truth.suspectMotives).map(([personId, motives]) => (
                  <tr key={personId}>
                    <td style={td}>{nameOf(truth.people, personId)}</td>
                    <td style={td}>
                      {motives.map((m, i) => (
                        <div key={i}>
                          {m.type} (force {m.strength.toFixed(2)}) — {m.description}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Chaînes de preuve indépendantes</h2>
            <p>{solvability.independentChannels.join(", ") || "aucune"}</p>
          </section>

          {visualManifest && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={sectionTitle}>Manifeste visuel</h2>
              <p style={{ color: "#8a94a6", marginBottom: 8 }}>
                Scène : {visualManifest.crimeScene.layoutTemplate} — {visualManifest.crimeScene.timeOfDay} · {visualManifest.evidence.length} preuve(s) ·{" "}
                {visualManifest.cctvFrames.length} image(s) CCTV
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={crimeSceneSvgDataUri(visualManifest.crimeScene)}
                alt=""
                style={{ width: 320, aspectRatio: "16/9", border: "1px solid #30363d", marginBottom: 12 }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {truth.people.map((p) => {
                  const descriptor = visualManifest.people.find((d) => d.personId === p.id);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #30363d", padding: 4 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={portraitService.getPortraitUrl(p.avatarSeed, `${p.firstName} ${p.lastName}`)} alt="" width={32} height={32} />
                      <span style={{ fontSize: 11 }}>
                        {p.firstName} {p.lastName}
                        <br />
                        {descriptor ? `${descriptor.hairstyle}, ${descriptor.clothingCategory}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Personnages ({truth.people.length})</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Nom</th>
                  <th style={th}>Âge</th>
                  <th style={th}>Profession</th>
                  <th style={th}>Rôles</th>
                </tr>
              </thead>
              <tbody>
                {truth.people.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>
                      {p.firstName} {p.lastName}
                    </td>
                    <td style={td}>{p.age}</td>
                    <td style={td}>{p.profession}</td>
                    <td style={td}>{p.roles.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Chronologie ({truth.timeline.length} événements)</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Heure</th>
                  <th style={th}>Acteur</th>
                  <th style={th}>Action</th>
                  <th style={th}>Description</th>
                </tr>
              </thead>
              <tbody>
                {[...truth.timeline]
                  .sort((a, b) => a.timestamp - b.timestamp)
                  .map((e) => (
                    <tr key={e.id} style={e.isCrimeEvent ? { background: "#3d1f1f" } : undefined}>
                      <td style={td}>{formatGameTime(e.timestamp)}</td>
                      <td style={td}>{nameOf(truth.people, e.actorId)}</td>
                      <td style={td}>{e.action}</td>
                      <td style={td}>{e.description}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Preuves ({truth.evidence.length})</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Type</th>
                  <th style={th}>Fiabilité</th>
                  <th style={th}>Red herring</th>
                  <th style={th}>Description</th>
                </tr>
              </thead>
              <tbody>
                {truth.evidence.map((e) => (
                  <tr key={e.id} style={e.isRedHerring ? { color: "#e3b341" } : undefined}>
                    <td style={td}>{e.type}</td>
                    <td style={td}>{e.reliability}</td>
                    <td style={td}>{e.isRedHerring ? "oui" : ""}</td>
                    <td style={td}>{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Alibis</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Personne</th>
                  <th style={th}>Vrai ?</th>
                  <th style={th}>Déclaration</th>
                </tr>
              </thead>
              <tbody>
                {truth.alibis.map((a) => (
                  <tr key={a.personId}>
                    <td style={td}>{nameOf(truth.people, a.personId)}</td>
                    <td style={{ ...td, color: a.isTrue ? "#7ee787" : "#ff7b72" }}>{a.isTrue ? "vrai" : "faux"}</td>
                    <td style={td}>{a.claim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={sectionTitle}>Relations ({truth.relationships.length})</h2>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>De</th>
                  <th style={th}>À</th>
                  <th style={th}>Type</th>
                </tr>
              </thead>
              <tbody>
                {truth.relationships.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{nameOf(truth.people, r.from)}</td>
                    <td style={td}>{nameOf(truth.people, r.to)}</td>
                    <td style={td}>{r.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

const sectionTitle: CSSProperties = { fontSize: 16, borderBottom: "1px solid #30363d", paddingBottom: 4, marginBottom: 8 };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: CSSProperties = { textAlign: "left", borderBottom: "1px solid #30363d", padding: "4px 8px", color: "#8a94a6" };
const td: CSSProperties = { borderBottom: "1px solid #21262d", padding: "4px 8px", verticalAlign: "top" };
