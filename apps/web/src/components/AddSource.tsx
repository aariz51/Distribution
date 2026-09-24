"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Field, Select, TextInput } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { formatBytes } from "@/components/ui/format";

type Rights = "owned" | "licensed" | "third_party_attested" | "unknown";

const RIGHTS: Array<{ value: Rights; label: string; hint: string }> = [
  { value: "owned", label: "I made it", hint: "Full reuse." },
  { value: "licensed", label: "Creative Commons / licensed", hint: "Licence is checked on ingest." },
  { value: "third_party_attested", label: "Permission from the rights holder", hint: "You attest below." },
  { value: "unknown", label: "Unknown", hint: "Analysis only, no footage reuse." },
];

const ATTEST_TEXT = "I confirm I hold written permission from the rights holder to cut and republish this footage.";

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string };
    return j.error ?? `Request failed (${r.status})`;
  } catch {
    return `Request failed (${r.status})`;
  }
}

export function AddSource({ productId }: { productId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState<Rights>("owned");
  const [attested, setAttested] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const needsAttest = rights === "third_party_attested";
  const rightsOk = !needsAttest || attested;
  const canSubmit = rightsOk && (mode === "url" ? /^https?:\/\//i.test(url.trim()) : file !== null);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let r: Response;
      if (mode === "url") {
        const body: { url: string; rights: Rights; attestation?: { text: string } } = { url: url.trim(), rights };
        if (needsAttest) body.attestation = { text: ATTEST_TEXT };
        r = await fetch(`/api/products/${productId}/sources`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } else {
        const fd = new FormData();
        fd.set("file", file!);
        fd.set("rights", rights);
        if (needsAttest) fd.set("attestation", ATTEST_TEXT);
        r = await fetch(`/api/products/${productId}/sources`, { method: "POST", body: fd });
      }
      if (!r.ok) throw new Error(await readError(r));
      const result = await r.json();
      if (result.processing?.status === "failed") setError(result.processing.error);
      setUrl("");
      setFile(null);
      setAttested(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <Card>
      <CardHeader
        title="Add a source"
        action={
          <div className="flex rounded-[8px] border border-hairline bg-canvas p-0.5 text-[13px]" role="tablist">
            {(["url", "upload"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("h-7 rounded-[6px] px-3 motion-safe:transition-colors", mode === m ? "bg-surface font-medium text-ink shadow-[var(--shadow-soft)]" : "text-muted hover:text-ink")}>
                {m === "url" ? "YouTube URL" : "Upload"}
              </button>
            ))}
          </div>
        }
      />
      <CardBody>
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          {mode === "url" ? (
            <Field label="Video URL" htmlFor="src-url" hint="Probed for licence and duration before anything is downloaded.">
              <TextInput id="src-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" inputMode="url" autoComplete="off" />
            </Field>
          ) : (
            <Field label="Video file" hint="MP4 or MOV. Large files upload in one request.">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                className={cn("flex min-h-[88px] items-center justify-between gap-3 rounded-[8px] border border-dashed px-4 py-3 text-sm motion-safe:transition-colors", drag ? "border-accent bg-accent-soft" : "border-hairline-strong bg-canvas")}
              >
                {file ? (
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.name}</p>
                    <p className="text-xs text-muted tabular-nums">{formatBytes(file.size)}</p>
                  </div>
                ) : (
                  <p className="text-muted">Drop a video here, or choose a file.</p>
                )}
                <div className="flex shrink-0 gap-1.5">
                  {file && (
                    <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                      Remove
                    </Button>
                  )}
                  <Button size="sm" onClick={() => fileRef.current?.click()}>
                    Choose file
                  </Button>
                </div>
                <input ref={fileRef} type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </Field>
          )}
          <Field label="Rights" htmlFor="src-rights" hint={RIGHTS.find((r) => r.value === rights)?.hint}>
            <Select id="src-rights" value={rights} onChange={(e) => setRights(e.target.value as Rights)}>
              {RIGHTS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        {needsAttest && (
          <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5">
            <Checkbox checked={attested} onChange={setAttested} label={<span className="text-amber-900">{ATTEST_TEXT}</span>} />
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
            {mode === "url" ? "Add source" : "Upload source"}
          </Button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
