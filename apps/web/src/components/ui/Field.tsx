import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export const controlClass =
  "block w-full rounded-[8px] border border-hairline-strong bg-surface px-3 text-sm text-ink placeholder:text-faint motion-safe:transition-colors hover:border-[#c6c1b6] focus:border-accent disabled:bg-canvas disabled:text-muted";

export function Field({ label, hint, required, optional, error, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; required?: boolean; optional?: boolean; error?: string | null; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-[11px] font-medium uppercase tracking-wide text-amber-700">required</span>}
        {optional && <span className="text-xs font-normal text-faint">optional</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, "h-9", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, "py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(controlClass, "h-9 appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 rounded-[8px] border border-hairline bg-surface px-3 py-2.5 text-sm", disabled ? "opacity-50" : "cursor-pointer hover:border-hairline-strong")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border motion-safe:transition-colors", checked ? "border-accent bg-accent" : "border-hairline-strong bg-canvas")}
      >
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm motion-safe:transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} style={{ boxShadow: "0 1px 2px rgba(20,23,26,.2)" }} />
      </button>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", disabled ? "opacity-50" : "cursor-pointer", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-hairline-strong accent-accent" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function HexChip({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">
      <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: hex }} />
      {hex.toLowerCase()}
    </span>
  );
}
