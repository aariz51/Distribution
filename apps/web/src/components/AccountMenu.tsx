"use client";
import { useEffect, useRef, useState } from "react";

export function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-full border border-hairline-strong bg-surface text-xs font-semibold text-ink motion-safe:transition-colors hover:bg-canvas"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 w-56 overflow-hidden rounded-[10px] border border-hairline bg-surface py-1 text-sm shadow-[0_1px_2px_rgba(20,23,26,.06),0_8px_24px_rgba(20,23,26,.08)]">
          <div className="px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Signed in as</p>
            <p className="truncate font-mono text-[12px] text-ink" title={email}>{email}</p>
          </div>
          <div className="mx-2 my-1 h-px bg-hairline" />
          <form action="/api/auth/logout" method="post">
            <button type="submit" role="menuitem" className="block w-full px-3 py-2 text-left text-ink hover:bg-canvas">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
