import { getCurrentGame } from "@/lib/game-session/current";
import { MainMenu } from "@/components/menu/MainMenu";

export const dynamic = "force-dynamic";

export default async function Home() {
  const game = await getCurrentGame();
  return <MainMenu hasActiveCase={!!game} resumeHref="/investigation/affaire" />;
}
