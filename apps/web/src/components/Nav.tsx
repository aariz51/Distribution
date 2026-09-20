import { AppShell } from "@/components/AppShell";

/** Backwards-compatible wrapper; prefer `AppShell`. */
export function Nav({ email }: { email: string }) {
  return <AppShell email={email}>{null}</AppShell>;
}
