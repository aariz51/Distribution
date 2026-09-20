import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { type Tone } from "./Pill";

const bar: Record<Tone, string> = {
  neutral: "bg-hairline-strong",
  gray: "bg-zinc-300",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  teal: "bg-accent",
  blue: "bg-sky-500",
};

export function StatTile({ label, value, hint, tone = "neutral", href, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string; className?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", bar[tone])} aria-hidden />
        <span className="text-xs font-medium text-muted">{label}</span>
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {hint != null && <div className="mt-2 text-xs text-faint">{hint}</div>}
    </>
  );
  const cls = cn("surface block px-4 py-4", href && "motion-safe:transition-colors hover:border-hairline-strong", className);
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
