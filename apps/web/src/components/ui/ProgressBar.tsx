import { cn } from "./cn";
import type { Tone } from "./Pill";

const fills: Record<Tone, string> = {
  neutral: "bg-ink",
  gray: "bg-zinc-400",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  teal: "bg-accent",
  blue: "bg-sky-500",
};

export function ProgressBar({ value, tone = "teal", className, indeterminate }: { value: number; tone?: Tone; className?: string; indeterminate?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hairline", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 ease-out", fills[tone], indeterminate && "motion-safe:animate-pulse")}
        style={{ width: `${indeterminate ? 30 : pct}%` }}
      />
    </div>
  );
}
