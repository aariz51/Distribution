"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";

async function submitJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function messageFrom(data: Record<string, unknown>, status: number): string {
  if (typeof data.error === "string" && data.error !== "validation") return data.error;
  const issues = data.issues as { message?: string }[] | undefined;
  if (issues?.[0]?.message) return issues[0].message;
  return status >= 500 ? "Something went wrong on our side. Try again in a minute." : "Check the details and try again.";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({ next, signupsOpen }: { next: string; signupsOpen: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await submitJson("/api/auth/login", { email, password }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Could not reach the server. Check your connection.");
    if (!r.ok) return setError(messageFrom(r.data, r.status));
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Your products, promos, clips and channels.</p>
      <div className="mt-8 space-y-4">
        <Field label="Email" htmlFor="email">
          <TextInput id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" autoFocus required />
        </Field>
        <Field label="Password" htmlFor="password" error={error}>
          <TextInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required aria-invalid={error ? true : undefined} />
        </Field>
      </div>
      <Button type="submit" variant="primary" className="mt-6 h-10 w-full text-base" disabled={!email || !password} loading={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      {signupsOpen && (
        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href={`/signup${next !== "/products" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink">
            Create a workspace
          </Link>
        </p>
      )}
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ workspace?: string; email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  function validate() {
    const next: typeof errors = {};
    if (!workspace.trim()) next.workspace = "Name your workspace. Your company or product name works.";
    if (!EMAIL.test(email.trim())) next.email = "Enter a valid email address.";
    if (password.length < 10) next.password = "Use at least 10 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    const r = await submitJson("/api/auth/signup", { workspace, email, password }).catch(() => null);
    setBusy(false);
    if (!r) return setErrors({ form: "Could not reach the server. Check your connection." });
    if (!r.ok) {
      const msg = messageFrom(r.data, r.status);
      return setErrors(r.status === 409 ? { email: msg } : { form: msg });
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1 text-sm text-muted">Your first promo can be rendering a few minutes from now.</p>
      <div className="mt-8 space-y-4">
        <Field label="Workspace name" htmlFor="workspace" error={errors.workspace}>
          <TextInput id="workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)} autoComplete="organization" autoFocus placeholder="Northwind Labs" aria-invalid={errors.workspace ? true : undefined} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <TextInput id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" aria-invalid={errors.email ? true : undefined} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={errors.password}>
          <TextInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" aria-invalid={errors.password ? true : undefined} />
        </Field>
      </div>
      {errors.form && (
        <p role="alert" className="mt-4 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errors.form}
        </p>
      )}
      <Button type="submit" variant="primary" className="mt-6 h-10 w-full text-base" loading={busy}>
        {busy ? "Creating workspace…" : "Create workspace"}
      </Button>
      <p className="mt-6 text-center text-sm text-muted">
        Already have one?{" "}
        <Link href="/login" className="font-medium text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink">
          Sign in
        </Link>
      </p>
    </form>
  );
}
