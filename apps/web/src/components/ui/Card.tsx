import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <section className={cn("surface", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, meta, action, className }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {meta != null && <span className="text-xs text-faint tabular-nums">{meta}</span>}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pb-5", className)}>{children}</div>;
}
