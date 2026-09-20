"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { formatBytes } from "@/components/ui/format";

function Preview({ file, className }: { file: File; className?: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={cn("h-full w-full object-cover", className)} />;
}

export function FileDrop({
  files,
  onChange,
  multiple = false,
  accept = "image/*",
  label,
  hint,
  previewAspect = "square",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  label: string;
  hint?: string;
  previewAspect?: "square" | "portrait";
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => (accept === "image/*" ? f.type.startsWith("image/") : true));
    if (!incoming.length) return;
    onChange(multiple ? [...files, ...incoming] : [incoming[0]!]);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ref.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer items-center justify-between gap-4 rounded-[8px] border border-dashed px-4 py-4 text-sm motion-safe:transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-hairline-strong bg-canvas hover:border-[#c6c1b6]",
        )}
      >
        <div>
          <p className="font-medium">{label}</p>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        <span className="shrink-0 text-xs text-muted">{drag ? "Release to add" : "Drop or browse"}</span>
        <input
          ref={ref}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className={cn("mt-3 grid gap-2", previewAspect === "portrait" ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-4 sm:grid-cols-8")}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="group relative">
              <div className={cn("overflow-hidden rounded-[8px] border border-hairline bg-surface", previewAspect === "portrait" ? "aspect-[9/16]" : "aspect-square")}>
                <Preview file={f} />
              </div>
              <p className="mt-1 truncate text-[11px] text-faint tabular-nums" title={f.name}>
                {formatBytes(f.size)}
              </p>
              <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {multiple && i > 0 && (
                  <Button
                    size="sm"
                    className="h-6 w-6 px-0"
                    aria-label="Move earlier"
                    onClick={(e) => {
                      e.stopPropagation();
                      const c = [...files];
                      [c[i - 1], c[i]] = [c[i]!, c[i - 1]!];
                      onChange(c);
                    }}
                  >
                    ←
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-6 w-6 px-0"
                  aria-label="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(files.filter((_, j) => j !== i));
                  }}
                >
                  ×
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
