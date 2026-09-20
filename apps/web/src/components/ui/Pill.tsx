import type { ReactNode } from "react";
import { cn } from "./cn";
import { humanize } from "./format";

export type Tone = "neutral" | "amber" | "emerald" | "red" | "teal" | "gray" | "blue";

const tones: Record<Tone, string> = {
  neutral: "bg-canvas text-muted border-hairline",
  gray: "bg-zinc-100 text-zinc-600 border-zinc-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  red: "bg-red-50 text-red-700 border-red-200",
  teal: "bg-accent-soft text-accent border-[#c9e3db]",
  blue: "bg-sky-50 text-sky-800 border-sky-200",
};

const dots: Record<Tone, string> = {
  neutral: "bg-faint",
  gray: "bg-zinc-400",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  teal: "bg-accent",
  blue: "bg-sky-500",
};

export const STATUS_TONE: Record<string, Tone> = {
  // assets
  draft: "gray",
  processing: "teal",
  review: "amber",
  approved: "emerald",
  scheduled: "blue",
  publishing: "teal",
  published: "emerald",
  failed: "red",
  archived: "gray",
  // approval
  pending: "amber",
  rejected: "red",
  // jobs
  queued: "gray",
  started: "teal",
  progress: "teal",
  retrying: "amber",
  completed: "emerald",
  cancelled: "gray",
  // sources
  discovered: "gray",
  downloading: "teal",
  ready: "emerald",
  // rights
  owned: "emerald",
  licensed: "emerald",
  third_party_attested: "amber",
  unknown: "gray",
  // palette
  inferred: "amber",
  confirmed: "emerald",
  provided: "emerald",
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function Pill({ tone, status, children, className, dot = true }: { tone?: Tone; status?: string; children?: ReactNode; className?: string; dot?: boolean }) {
  const t = tone ?? (status ? toneFor(status) : "neutral");
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium leading-none", tones[t], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dots[t])} aria-hidden />}
      {children ?? (status ? humanize(status) : null)}
    </span>
  );
}
