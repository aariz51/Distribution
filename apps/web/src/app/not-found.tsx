import Link from "next/link";
import { Wordmark } from "@/components/AppShell";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark className="text-base" />
      <p className="mt-12 font-mono text-sm text-faint">404</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">This page did not get distributed.</h1>
      <p className="mt-4 max-w-[44ch] text-base text-muted">The link may be old, or the item was removed. Your work is still where you left it.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="landing-cta">Home</Link>
        <Link href="/products" className="inline-flex items-center rounded-full border border-hairline-strong px-6 py-3 text-base font-semibold hover:bg-surface">
          Your products
        </Link>
      </div>
    </main>
  );
}
