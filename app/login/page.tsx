import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { AuthForm } from "@/components/auth/AuthForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!isSupabaseConfigured()) redirect("/");
  const { authenticated } = await getCurrentIdentity();
  if (authenticated) redirect("/");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background-deep px-6">
      <div className="menu-sweep pointer-events-none absolute inset-0" />
      <div className="crt-vignette" />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center border-2 border-accent text-2xl font-bold text-accent-strong">
            C
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-[0.3em] text-foreground">CASELINE</h1>
          <p className="font-data text-[11px] uppercase tracking-[0.32em] text-muted">Accès réseau police</p>
        </div>
        <AuthForm />
      </div>
    </div>
  );
}
