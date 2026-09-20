"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LibraryAsset } from "@/lib/library";

const STATUS_TONE: Record<string, string> = {
  review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-sky-100 text-sky-800",
  publishing: "bg-sky-100 text-sky-800",
  published: "bg-emerald-200 text-emerald-900",
  failed: "bg-red-100 text-red-800",
  archived: "bg-zinc-100 text-zinc-500",
  processing: "bg-zinc-100 text-zinc-600",
  draft: "bg-zinc-100 text-zinc-600",
};

export function Library({ assets }: { assets: LibraryAsset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LibraryAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  async function act(id: string, action: "approve" | "reject" | "archive" | "restore") {
    setBusy(true);
    const reason = action === "reject" ? window.prompt("Why? (stored with the asset)") ?? undefined : undefined;
    await fetch(`/api/assets/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason }) });
    setBusy(false);
    setOpen(null);
    router.refresh();
  }

  const visible = assets.filter((a) => (filter === "all" ? a.status !== "archived" : a.status === filter));
  const counts = assets.reduce<Record<string, number>>((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {});

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Content library <span className="text-zinc-400">({visible.length})</span></h2>
        <div className="flex gap-1 text-xs">
          {["all", "review", "approved", "scheduled", "published", "failed", "archived"].map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`rounded-full px-2.5 py-1 ${filter === s ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
              {s}{s !== "all" && counts[s] ? ` ${counts[s]}` : ""}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">Nothing here yet. Add a source and generate shorts, or start a promo film.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
              <button onClick={() => setOpen(a)} className="block w-full text-left">
                <div className="relative aspect-[9/16] w-full bg-zinc-200">
                  {a.type === "thumbnail" || a.type === "creative_image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt="" className="h-full w-full object-cover" />
                  ) : a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <video src={a.url} muted preload="metadata" className="h-full w-full object-cover" />
                  )}
                  <span className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] ${STATUS_TONE[a.status] ?? ""}`}>{a.status}</span>
                  {a.durationSec ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{Math.round(a.durationSec)}s</span> : null}
                </div>
                <div className="p-2">
                  <p className="line-clamp-2 text-xs font-medium">{String(a.metadata.title ?? a.metadata.headline ?? a.metadata.hook ?? a.type)}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{a.type} · {a.copy.length ? `${a.copy.length} platforms` : "no copy yet"}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
              <div>
                {open.type === "thumbnail" || open.type === "creative_image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={open.url} alt="" className="w-full rounded-lg" />
                ) : (
                  <video src={open.url} controls className="w-full rounded-lg bg-black" />
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {open.status === "review" && <button disabled={busy} onClick={() => act(open.id, "approve")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white">Approve</button>}
                  {open.status === "review" && <button disabled={busy} onClick={() => act(open.id, "reject")} className="rounded-md border px-3 py-1.5 text-xs">Reject</button>}
                  {open.status === "approved" && <button disabled={busy} onClick={() => act(open.id, "archive")} className="rounded-md border px-3 py-1.5 text-xs">Archive</button>}
                  {open.status === "archived" && <button disabled={busy} onClick={() => act(open.id, "restore")} className="rounded-md border px-3 py-1.5 text-xs">Restore to review</button>}
                  <a href={open.url} download className="rounded-md border px-3 py-1.5 text-xs">Download</a>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-zinc-600">
                  <dt>Status</dt><dd>{open.status} · {open.approvalState}</dd>
                  {open.width && <><dt>Size</dt><dd>{open.width}×{open.height}{open.durationSec ? ` · ${Math.round(open.durationSec)}s` : ""}</dd></>}
                  {typeof open.metadata.score === "number" && <><dt>Score</dt><dd>{Math.round((open.metadata.score as number) * 100)}% · rank {String(open.metadata.rank)}</dd></>}
                  {open.metadata.cropPlan ? <><dt>Crop</dt><dd>{String(open.metadata.cropPlan)}</dd></> : null}
                  {open.metadata.captionPreset ? <><dt>Captions</dt><dd>{String(open.metadata.captionPreset)}{open.metadata.captionsBurned === false ? " (not burned)" : ""}</dd></> : null}
                  {open.approvalReason && <><dt>Reason</dt><dd>{open.approvalReason}</dd></>}
                </dl>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{String(open.metadata.title ?? open.metadata.headline ?? open.metadata.hook ?? open.type)}</h3>
                {open.metadata.rationale ? <p className="mt-1 text-sm text-zinc-600">{String(open.metadata.rationale)}</p> : null}
                <h4 className="mt-4 text-sm font-medium">Platform copy</h4>
                {open.copy.length === 0 ? (
                  <p className="mt-1 text-sm text-zinc-500">Copy is generated as a job after the clip renders.</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {open.copy.map((c) => (
                      <li key={c.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{c.platform} · v{c.version}</p>
                        {c.title && <p className="mt-1 font-medium">{c.title}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-zinc-800">{c.caption}</p>
                        {c.hashtags.length > 0 && <p className="mt-1 text-xs text-sky-700">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>}
                        {c.cta && <p className="mt-1 text-xs text-zinc-500">CTA: {c.cta}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await fetch(`/api/assets/${open.id}/copy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ regenerate: true }) });
                    setBusy(false);
                    router.refresh();
                  }}
                  className="mt-3 rounded-md border px-3 py-1.5 text-xs"
                >
                  Regenerate copy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
