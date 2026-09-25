export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-canvas" />
      </span>
      Distribution
    </span>
  );
}
