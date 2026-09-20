"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("founder@local");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 401 ? "Wrong password." : `Sign-in failed (${res.status}).`);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Distribution</h1>
        <p className="mt-1 text-sm text-zinc-600">Sign in to your workspace.</p>
        <label className="mt-6 block text-sm">
          <span className="text-zinc-700">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
        </label>
        <label className="mt-4 block text-sm">
          <span className="text-zinc-700">Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoFocus className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2" />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button disabled={busy || !password} className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
