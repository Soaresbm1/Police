"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    const supabase = createBrowserSupabaseClient();

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setPending(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      setPending(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        setInfo("Compte créé — vérifiez votre boîte mail pour confirmer votre adresse avant de vous connecter.");
        return;
      }
      router.push("/");
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="fade-up panel panel-bracketed flex w-full max-w-sm flex-col gap-4 p-6">
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`flex-1 border-b-2 py-2 text-xs uppercase tracking-widest ${mode === "signin" ? "border-accent text-accent-strong" : "border-transparent text-muted"}`}
        >
          Connexion
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 border-b-2 py-2 text-xs uppercase tracking-widest ${mode === "signup" ? "border-accent text-accent-strong" : "border-transparent text-muted"}`}
        >
          Créer un compte
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label">Adresse e-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border border-border-strong bg-surface-sunken px-3 py-2 text-base text-foreground focus:border-accent focus:outline-none sm:text-sm"
          autoComplete="email"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="field-label">Mot de passe</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-border-strong bg-surface-sunken px-3 py-2 text-base text-foreground focus:border-accent focus:outline-none sm:text-sm"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </div>

      {error && <p className="border border-danger/30 bg-danger-bg p-2 text-xs text-danger">{error}</p>}
      {info && <p className="border border-success/30 bg-success/5 p-2 text-xs text-success">{info}</p>}

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Veuillez patienter…" : mode === "signin" ? "Se connecter" : "Créer le compte"}
      </button>
    </form>
  );
}
