"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50">
        Add logo<input type="file" accept="image/*" className="hidden" onChange={(e) => upload("logo", e.target.files)} />
      </label>
      <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50">
        Add screenshots<input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload("screenshot", e.target.files)} />
      </label>
      {busy && <span className="text-zinc-500">{busy}</span>}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
