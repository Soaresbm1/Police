import { getCurrentGame } from "@/lib/game-session/current";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { getStore } from "@/lib/game-session/persistence";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MainMenu } from "@/components/menu/MainMenu";

export const dynamic = "force-dynamic";

export default async function Home() {
  const identity = await getCurrentIdentity();
  const game = identity.authenticated ? await getCurrentGame() : null;

  let profile = null;
  let caseHistoryCount = 0;
  if (identity.authenticated) {
    const store = getStore();
    [profile, caseHistoryCount] = await Promise.all([
      store.getProfile(identity.userId),
      store.listCaseHistory(identity.userId).then((list) => list.length),
    ]);
  }

  return (
    <MainMenu
      hasActiveCase={!!game}
      resumeHref="/investigation/affaire"
      supabaseConfigured={isSupabaseConfigured()}
      authenticated={identity.authenticated}
      displayEmail={identity.displayEmail}
      profile={profile}
      caseHistoryCount={caseHistoryCount}
    />
  );
}
