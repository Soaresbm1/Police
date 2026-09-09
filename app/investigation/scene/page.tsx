import { getCurrentGame } from "@/lib/game-session/current";
import { getLocation, getPerson, getVisibleEvidence } from "@/lib/game-session/player-view";
import { getCrimeSceneHotspots } from "@/lib/game-session/crime-scene";
import { CrimeSceneScreen } from "@/components/investigation/CrimeSceneScreen";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { buildCrimeSceneVisualDescriptor } from "@/lib/art/visual-manifest";
import { crimeSceneSvgDataUri } from "@/lib/art/scene-renderer";
import { getReadyCrimeSceneUrl } from "@/lib/art/generation/scene-lookup";
import { ArtRefreshWatcher } from "@/components/investigation/ArtRefreshWatcher";

export default async function ScenePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session, userId } = game;
  const hotspots = getCrimeSceneHotspots(truth, session);
  const location = getLocation(truth, truth.crimeLocationId);
  const victim = getPerson(truth, truth.victimId)!;
  const sceneDescriptor = location ? buildCrimeSceneVisualDescriptor(location, truth.crimeTimestamp) : null;
  const sceneBackground = sceneDescriptor ? crimeSceneSvgDataUri(sceneDescriptor) : null;
  const generatedSceneBackground = sceneDescriptor ? await getReadyCrimeSceneUrl(userId, sceneDescriptor) : null;

  const visibleById = new Map(getVisibleEvidence(truth, session).map((ev) => [ev.id, ev]));
  const evidenceDetails = hotspots
    .filter((h) => h.evidenceId && visibleById.has(h.evidenceId))
    .map((h) => {
      const ev = visibleById.get(h.evidenceId!)!;
      return {
        evidenceId: ev.id,
        reliability: ev.reliability,
        playerStatus: ev.playerStatus,
        requiresLabAnalysis: ev.requiresLabAnalysis,
      };
    });

  return (
    <>
      <ArtRefreshWatcher pending={Boolean(sceneDescriptor) && !generatedSceneBackground} />
      <CrimeSceneScreen
        hotspots={hotspots}
        evidenceDetails={evidenceDetails}
        locationName={location?.name ?? "Scène de crime"}
        locationAddress={location?.address ?? ""}
        victimName={`${victim.firstName} ${victim.lastName}`}
        sceneBackground={sceneBackground}
        generatedSceneBackground={generatedSceneBackground}
        autopsy={{
          estimatedDeathWindowStart: formatGameTime(truth.autopsy.estimatedDeathWindowStart),
          estimatedDeathWindowEnd: formatGameTime(truth.autopsy.estimatedDeathWindowEnd),
          causeOfDeath: truth.autopsy.causeOfDeath,
          bodyPosition: truth.autopsy.bodyPosition,
          wounds: truth.autopsy.wounds,
        }}
      />
    </>
  );
}
