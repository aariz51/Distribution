"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "@/components/ui/Button";

export function AssetUploader({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: "logo" | "screenshot" | "other", files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const [i, f] of Array.from(files).entries()) {
      setBusy(`Uploading ${i + 1}/${files.length}…`);
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", f);
      const r = await fetch(`/api/products/${productId}/assets`, { method: "POST", body: fd });
      if (!r.ok) {
        setError(((await r.json()) as { error?: string }).error ?? "upload failed");
        break;
      }
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
        Add logo<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload("logo", e.target.files)} />
      </label>
      <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
        Add screenshots<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => upload("screenshot", e.target.files)} />
      </label>
      {busy && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Spinner /> {busy}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
