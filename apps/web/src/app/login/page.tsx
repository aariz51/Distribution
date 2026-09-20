"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";

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
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex justify-center">
          <Wordmark className="text-base" />
        </div>
        <form onSubmit={submit} className="surface p-6" noValidate>
          <h1 className="text-[20px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Your workspace, product profiles and library.</p>
          <div className="mt-6 space-y-4">
            <Field label="Email" htmlFor="email">
              <TextInput id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
            </Field>
            <Field label="Password" htmlFor="password" error={error}>
              <TextInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" autoFocus aria-invalid={error ? true : undefined} />
            </Field>
          </div>
          <Button type="submit" variant="primary" className="mt-6 w-full" disabled={!password} loading={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-faint">Local workspace · sessions last 14 days</p>
      </div>
    </main>
  );
}
