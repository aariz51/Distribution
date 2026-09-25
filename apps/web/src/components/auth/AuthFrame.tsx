import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/AppShell";

/** Shared frame for sign-in and sign-up: the form, and what the account is for. */
export function AuthFrame({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <main id="main" className="flex flex-col px-6 py-8">
        <Link href="/" className="w-max rounded-[6px]" aria-label="Distribution home">
          <Wordmark className="text-base" />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </div>
      </main>
      <aside className="hidden border-l border-hairline bg-ink px-12 py-12 text-canvas lg:flex lg:flex-col lg:justify-center">{aside}</aside>
    </div>
  );
}

export function safeNext(next: string | undefined, fallback: string): string {
  // Only same-site paths; "//host" and schemes would make this an open redirect.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
