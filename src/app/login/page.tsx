"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ip, setIp] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ip")
      .then((r) => r.json())
      .then((d) => setIp(d.ip || null))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const params = new URLSearchParams(window.location.search);
        const from = params.get("from") || "/";
        window.location.href = from.startsWith("/") ? from : "/";
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Mot de passe incorrect");
      }
    } catch {
      setError("Erreur réseau, réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6"
      >
        <div className="mb-1 text-2xl font-bold tracking-tight">
          Crésus <span className="text-muted font-normal">· Arte Collective</span>
        </div>
        <p className="mb-5 text-sm text-muted">Accès réservé — entre le mot de passe.</p>

        <label className="mb-1 block text-xs uppercase tracking-wide text-muted" htmlFor="pw">
          Mot de passe
        </label>
        <input
          id="pw"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="••••••••"
        />

        {error && <div className="mt-3 rounded-lg bg-neg/10 px-3 py-2 text-sm text-neg">{error}</div>}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
        >
          {loading ? "Connexion…" : "Entrer"}
        </button>

        {ip && (
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
            Astuce : pour ne plus taper le mot de passe depuis ce réseau, ajoute ton IP{" "}
            <code className="text-accent">{ip}</code> à la variable <code>ALLOWED_IPS</code> sur Vercel.
          </p>
        )}
      </form>
    </main>
  );
}
