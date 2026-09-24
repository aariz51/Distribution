"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Pill, Select, TextInput } from "@/components/ui";
import { formatDateTime, formatRelative, typeLabel } from "@/components/ui/format";

export interface Channel {
  id: string;
  name: string;
  identifier: string;
  platform: string;
  picture: string | null;
  disabled: boolean;
}

export interface ScheduleItem {
  id: string;
  assetId: string;
  assetType: string;
  channelId: string;
  channelName: string;
  platform: string;
  scheduledFor: string;
  status: string;
  publishedUrl: string | null;
  postizPostId: string | null;
  lastError: string | null;
  attempts: number;
  hook: string | null;
}

export interface SchedulableAsset {
  id: string;
  type: string;
  durationSec: number | null;
  thumbnailUrl: string | null;
  hook: string | null;
  copyPlatforms: string[];
}

async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `request failed (${res.status})`);
  return data;
}

/** Connected Postiz channels. Refresh is explicit — it is the only call that hits the provider. */
export function ChannelsCard({ channels, hasConnection }: { channels: Channel[]; hasConnection: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const conns = (await (await fetch("/api/postiz/connections")).json()) as { connections?: { id: string }[] };
      const id = conns.connections?.[0]?.id;
      if (!id) throw new Error("no connection configured");
      await post(`/api/postiz/connections/${id}/refresh`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/postiz/connections", { label: "Default", apiKey });
      setApiKey("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Channels"
        meta={hasConnection ? `${channels.filter((c) => !c.disabled).length} connected` : "not connected"}
        action={hasConnection ? <Button size="sm" onClick={refresh} loading={busy}>Refresh</Button> : undefined}
      />
      <CardBody>
        {!hasConnection ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">Paste a Postiz public API key (Settings → Developers) to list your channels.</p>
            <div className="flex gap-2">
              <TextInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Postiz API key" />
              <Button variant="primary" onClick={connect} loading={busy} disabled={apiKey.length < 8}>Connect</Button>
            </div>
          </div>
        ) : channels.length === 0 ? (
          <EmptyState compact title="No channels cached yet." action={<Button size="sm" onClick={refresh} loading={busy}>Fetch from Postiz</Button>} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-3 py-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--canvas)] text-[10px] font-semibold uppercase">{c.platform.slice(0, 2)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <Pill tone={c.disabled ? "gray" : "emerald"} dot={false}>{c.platform}</Pill>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </CardBody>
    </Card>
  );
}

/** Schedule an approved asset onto one or more channels. */
export function ScheduleForm({ assets, channels, timezone }: { assets: SchedulableAsset[]; channels: Channel[]; timezone: string }) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asset = assets.find((a) => a.id === assetId);
  // A channel is only offerable when copy exists for its platform.
  const usable = useMemo(() => channels.filter((c) => !c.disabled && (asset?.copyPlatforms.includes(c.platform) ?? false)), [channels, asset]);
  const missing = useMemo(() => channels.filter((c) => !c.disabled && !(asset?.copyPlatforms.includes(c.platform) ?? false)), [channels, asset]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/assets/${assetId}/schedule`, { channelIds: picked, scheduledFor: new Date(when).toISOString() });
      setPicked([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) {
    return (
      <Card>
        <CardHeader title="Schedule a post" />
        <CardBody>
          <EmptyState compact title="Nothing approved yet — approve a clip in the library first." />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Schedule a post" meta={timezone} />
      <p className="px-5 pt-3 text-xs text-[var(--muted)]">Approve the generated YouTube cover in the library before scheduling. YouTube receives that cover. Custom covers on other platforms are not currently sent; those platforms choose their preview frame. YouTube Shorts may use a platform-selected frame.</p>
      <CardBody className="space-y-4">
        <Field label="Asset">
          <Select value={assetId} onChange={(e) => { setAssetId(e.target.value); setPicked([]); }}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {typeLabel(a.type)}
                {a.hook ? ` — ${a.hook.slice(0, 60)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Channels" hint={missing.length > 0 ? `No copy yet for: ${missing.map((m) => m.platform).join(", ")}` : undefined}>
          {usable.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Generate copy for this asset in the library, then its channels appear here.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {usable.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={picked.includes(c.id)}
                  onChange={(v) => setPicked((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  label={`${c.name} · ${c.platform}`}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label="When">
          <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button variant="primary" onClick={submit} loading={busy} disabled={picked.length === 0}>
          Schedule {picked.length > 0 ? `on ${picked.length} channel${picked.length > 1 ? "s" : ""}` : ""}
        </Button>
      </CardBody>
    </Card>
  );
}

/** Proposes slots from the product's cadence, then applies them on confirm. */
export function AutoFillCard({ productId, hasCadence }: { productId: string; hasCadence: boolean }) {
  const router = useRouter();
  const [slots, setSlots] = useState<{ assetId: string; hook: string | null; channelName: string; platform: string; scheduledFor: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = (await post("/api/postiz/autofill", { productId, dryRun })) as { slots: typeof slots };
      if (dryRun) setSlots(data.slots ?? []);
      else {
        setSlots(null);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Auto-fill" meta="cadence rules" action={<Button size="sm" onClick={() => run(true)} loading={busy} disabled={!hasCadence}>Preview</Button>} />
      <CardBody>
        {!hasCadence ? (
          <p className="text-sm text-[var(--muted)]">Set a posting cadence on the product to auto-fill the calendar.</p>
        ) : slots === null ? (
          <p className="text-sm text-[var(--muted)]">Lays approved assets onto your cadence windows, respecting the minimum gap between posts on a channel.</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No free slots found — either nothing is approved or every window is taken.</p>
        ) : (
          <>
            <ul className="mb-3 space-y-1 text-sm">
              {slots.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-1 last:border-0">
                  <span className="min-w-0 truncate">{s.hook ?? "asset"}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{s.channelName} · {formatDateTime(s.scheduledFor)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => run(false)} loading={busy}>Apply {slots.length} slots</Button>
              <Button size="sm" onClick={() => setSlots(null)}>Discard</Button>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </CardBody>
    </Card>
  );
}

/** Everything scheduled, publishing, published or failed, soonest first. */
export function ScheduleList({ items }: { items: ScheduleItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [postIds, setPostIds] = useState<Record<string, string>>({});

  async function update(item: ScheduleItem, action: "cancel" | "reconcile") {
    setBusy(item.id); setErrors(previous => ({ ...previous, [item.id]: "" }));
    try {
      const response = await fetch(`/api/assets/${item.assetId}/schedule/${item.id}`, {
        method: action === "cancel" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        ...(action === "reconcile" ? { body: JSON.stringify({ postId: postIds[item.id] ?? item.postizPostId ?? "" }) } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update this schedule");
      router.refresh();
    } catch (error) { setErrors(previous => ({ ...previous, [item.id]: error instanceof Error ? error.message : "Could not update this schedule" })); }
    finally { setBusy(null); }
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader title="Calendar" />
        <CardBody>
          <EmptyState compact title="Nothing scheduled yet." />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Calendar" meta={`${items.length} post${items.length > 1 ? "s" : ""}`} />
      <CardBody className="p-0">
        <ul className="divide-y divide-[var(--hairline)]">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Pill status={i.status} />
              <span className="min-w-0 flex-1 truncate text-sm">{i.hook ?? typeLabel(i.assetType)}</span>
              <span className="text-xs text-[var(--muted)]">{i.channelName} · {i.platform}</span>
              <span className="text-xs tabular-nums text-[var(--muted)]" title={formatDateTime(i.scheduledFor)}>{formatRelative(i.scheduledFor)}</span>
              {i.publishedUrl && (
                <a href={i.publishedUrl} target="_blank" rel="noreferrer" className="text-xs underline">view</a>
              )}
              {(i.status === "scheduled" || i.status === "failed") && (
                <Button size="sm" variant="ghost" onClick={() => update(i, "cancel")} loading={busy === i.id}>Cancel</Button>
              )}
              {(i.status === "publishing" || i.status === "failed") && i.attempts > 0 && <div className="w-full space-y-2 pt-2">
                <p className="text-xs text-[var(--muted)]">If a status check stopped, confirm the matching post in Postiz and enter its ID to resume checking.</p>
                <div className="flex gap-2">
                  <TextInput aria-label={`Postiz post ID for ${i.channelName}`} value={postIds[i.id] ?? i.postizPostId ?? ""} onChange={event => setPostIds(previous => ({ ...previous, [i.id]: event.target.value }))} placeholder="Postiz post ID" />
                  <Button size="sm" variant="secondary" loading={busy === i.id} disabled={!(postIds[i.id] ?? i.postizPostId ?? "").trim()} onClick={() => update(i, "reconcile")}>Resume status checks</Button>
                </div>
              </div>}
              {errors[i.id] && <p role="alert" className="w-full text-xs text-red-600">{errors[i.id]}</p>}
              {i.lastError && <p className="w-full text-xs text-red-600">{i.lastError}</p>}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
