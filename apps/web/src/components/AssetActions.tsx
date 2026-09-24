"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AssetItem as AssetView, CopyItem as CopyView } from "@/components/views";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/components/ui/cn";
import { JobProgress } from "@/components/JobProgress";

const DEFAULT_PLATFORMS = ["instagram", "tiktok", "youtube", "x", "linkedin"];

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string };
    return j.error ?? `Request failed (${r.status})`;
  } catch {
    return `Request failed (${r.status})`;
  }
}

export function AssetActions({ asset, platforms }: { asset: AssetView; platforms: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyJobId, setCopyJobId] = useState<string | null>(null);
  const choices = platforms.length ? platforms : DEFAULT_PLATFORMS;
  const [picked, setPicked] = useState<string[]>(choices);

  type Action = "approve" | "reject" | "archive" | "restore";
  // The route accepts {action}; the documented contract is {approvalState}. Send both — zod strips unknown keys.
  const APPROVAL_STATE: Record<Action, "approved" | "rejected" | "pending"> = { approve: "approved", reject: "rejected", archive: "rejected", restore: "pending" };

  async function act(action: Action) {
    let reason: string | undefined;
    if (action === "reject") {
      const r = window.prompt("Why is this asset rejected? (optional, stored with the asset)");
      if (r === null) return;
      reason = r.trim() || undefined;
    }
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, approvalState: APPROVAL_STATE[action], ...(reason ? { reason } : {}) }) });
      if (!r.ok) throw new Error(await readError(r));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function generateCopy() {
    if (picked.length === 0) return;
    setBusy("copy");
    setError(null);
    try {
      const r = await fetch(`/api/assets/${asset.id}/copy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ regenerate: true, platforms: picked }) });
      if (!r.ok) throw new Error(await readError(r));
      const body = await r.json() as { jobId: string };
      setCopyJobId(body.jobId);
      setCopyOpen(false);
      setOpen(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const archived = asset.status === "archived";
  const locked = asset.status === "published" || asset.status === "publishing" || asset.status === "scheduled";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!archived && !locked && asset.status === "review" && (
          <Button size="sm" variant="primary" loading={busy === "approve"} disabled={busy !== null} onClick={() => act("approve")}>
            Approve
          </Button>
        )}
        {!archived && !locked && (
          <Button size="sm" variant={asset.status === "approved" ? "danger" : "secondary"} loading={busy === "reject"} disabled={busy !== null} onClick={() => act("reject")}>
            Reject
          </Button>
        )}
        {archived && (
          <Button size="sm" loading={busy === "restore"} disabled={busy !== null} onClick={() => act("restore")}>
            Restore to review
          </Button>
        )}
        {!archived && (asset.status === "failed" || asset.status === "approved") && (
          <Button size="sm" variant="ghost" loading={busy === "archive"} disabled={busy !== null} onClick={() => act("archive")}>
            Archive
          </Button>
        )}
        {asset.status !== "failed" && <a href={asset.url} download className="rounded px-2 py-1 text-xs underline underline-offset-2">Download</a>}
        <Button size="sm" variant="ghost" disabled={busy !== null || asset.status === "failed"} onClick={() => setCopyOpen((o) => !o)} aria-expanded={copyOpen}>
          {asset.copy.length ? "Regenerate copy" : "Generate copy"}
        </Button>
        {asset.copy.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide copy" : `Copy · ${new Set(asset.copy.map((c) => c.platform)).size}`}
          </Button>
        )}
      </div>

      {copyOpen && (
        <div className="mt-3 rounded-[8px] border border-hairline bg-canvas p-3">
          <p className="mb-2 text-xs font-medium text-muted">Platforms</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {choices.map((p) => (
              <Checkbox key={p} checked={picked.includes(p)} onChange={(v) => setPicked((ps) => (v ? [...ps, p] : ps.filter((x) => x !== p)))} label={<span className="capitalize">{p}</span>} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="primary" loading={busy === "copy"} disabled={picked.length === 0 || busy !== null} onClick={generateCopy}>
              Generate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {copyJobId && <div className="mt-3" aria-label="Copy generation">
        <JobProgress key={copyJobId} jobId={copyJobId} initial={{ status: "queued", progressPct: 0, currentStep: null, attempts: 0, error: null, result: null }} />
      </div>}
      {asset.approvalReason && asset.approvalState === "rejected" && <p className="mt-2 text-xs text-muted">Reason: {asset.approvalReason}</p>}

      {open && asset.copy.length > 0 && <CopyDrawer copy={asset.copy} />}
    </div>
  );
}

function latestPerPlatform(copy: CopyView[]): CopyView[] {
  const seen = new Map<string, CopyView>();
  for (const c of copy) {
    const prev = seen.get(c.platform);
    if (!prev || c.version > prev.version) seen.set(c.platform, c);
  }
  return [...seen.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

function CopyDrawer({ copy }: { copy: CopyView[] }) {
  const items = latestPerPlatform(copy);
  const [active, setActive] = useState(items[0]?.platform ?? "");
  const c = items.find((x) => x.platform === active) ?? items[0];
  if (!c) return null;
  return (
    <div className="mt-3 rounded-[8px] border border-hairline bg-surface">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline px-2 pt-1">
        {items.map((it) => (
          <button
            key={it.platform}
            type="button"
            onClick={() => setActive(it.platform)}
            className={cn("-mb-px h-8 whitespace-nowrap border-b-2 px-2 text-[12px] capitalize motion-safe:transition-colors", it.platform === c.platform ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {it.platform}
          </button>
        ))}
        <span className="ml-auto pr-1 font-mono text-[11px] text-faint tabular-nums">v{c.version}</span>
      </div>
      <div className="space-y-3 p-3 text-[13px]">
        <CopyRow label="Hook" text={c.hook} />
        <CopyRow label="Title" text={c.title} />
        <CopyRow label="Caption" text={c.caption} multiline />
        {c.description && <CopyRow label="Description" text={c.description} multiline />}
        {c.hashtags.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Hashtags</span>
              <CopyButton text={c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")} />
            </div>
            <div className="flex flex-wrap gap-1">
              {c.hashtags.map((h) => (
                <span key={h} className="rounded-full border border-hairline bg-canvas px-2 py-0.5 font-mono text-[11px] text-muted">{h.startsWith("#") ? h : `#${h}`}</span>
              ))}
            </div>
          </div>
        )}
        <CopyRow label="CTA" text={c.cta} />
        {c.approved && <Pill tone="emerald">Copy approved</Pill>}
      </div>
    </div>
  );
}

function CopyRow({ label, text, multiline }: { label: string; text: string; multiline?: boolean }) {
  if (!text) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
        <CopyButton text={text} />
      </div>
      <p className={cn("text-ink", multiline && "whitespace-pre-wrap leading-relaxed")}>{text}</p>
    </div>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button type="button" onClick={copy} className={cn("rounded-[6px] px-1.5 py-0.5 text-[11px] text-muted motion-safe:transition-colors hover:bg-canvas hover:text-ink", className)} aria-label={`Copy ${text.slice(0, 30)}`}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
