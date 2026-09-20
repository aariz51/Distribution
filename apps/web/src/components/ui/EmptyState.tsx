import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({ title, action, className, compact }: { title: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-[10px] border border-dashed border-hairline-strong bg-surface text-center", compact ? "px-4 py-6" : "px-6 py-12", className)}>
      <p className="text-sm text-muted">{title}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
