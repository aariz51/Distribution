"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  label: ReactNode;
  href: string;
  /** exact = only active on exact pathname match; otherwise prefix match */
  exact?: boolean;
  count?: number;
}

/** Underlined sub-navigation (used for product sections). */
export function SubNav({ items, className }: { items: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("-mb-px flex items-center gap-1 overflow-x-auto", className)} aria-label="Section">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm motion-safe:transition-colors",
              active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {it.label}
            {it.count != null && <span className="rounded-full bg-canvas px-1.5 text-[11px] tabular-nums text-faint">{it.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Pill filters driven by a `?key=value` search param. */
export function FilterPills({ param, options, className }: { param: string; options: Array<{ label: string; value: string | null; count?: number }>; className?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get(param);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="tablist">
      {options.map((o) => {
        const active = (o.value ?? null) === current;
        const params = new URLSearchParams(sp.toString());
        if (o.value) params.set(param, o.value);
        else params.delete(param);
        const qs = params.toString();
        return (
          <Link
            key={o.label}
            href={qs ? `${pathname}?${qs}` : pathname}
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] motion-safe:transition-colors",
              active ? "border-ink bg-ink text-white" : "border-hairline bg-surface text-muted hover:border-hairline-strong hover:text-ink",
            )}
          >
            {o.label}
            {o.count != null && <span className={cn("tabular-nums text-[11px]", active ? "text-white/70" : "text-faint")}>{o.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
