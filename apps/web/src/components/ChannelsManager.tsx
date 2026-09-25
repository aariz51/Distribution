"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CheckCircle, Plugs, PlugsConnected, Trash, WarningCircle } from "@phosphor-icons/react";
import { Button, Card, CardBody, CardHeader, Field, Pill, TextInput } from "@/components/ui";
import { formatRelative } from "@/components/ui/format";
import { PlatformIcon, platformColor } from "@/components/PlatformIcon";

export interface ManagedChannel {
  id: string;
  name: string;
  identifier: string;
  platform: string;
  picture: string | null;
  disabled: boolean;
}

export interface ConnectableProvider {
  id: string;
  label: string;
}

const POLL_MS = 4000;
const POLL_FOR_MS = 4 * 60_000;

/** Points the pre-opened tab at the provider, cut off from this page. */
function sendTo(tab: Window | null, url: string): void {
  if (!tab) {
    window.location.assign(url);
    return;
  }
  tab.opener = null;
  tab.location.replace(url);
}

async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${res.status}).`);
  return data;
}

function PostizKeyForm({ onConnected }: { onConnected: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/api/postiz/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Default", apiKey }) });
      setApiKey("");
      onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Connect your publishing workspace" meta="Step 1 of 2" />
      <CardBody>
        <ol className="grid gap-4 text-sm text-muted sm:grid-cols-3">
          <li>
            <span className="font-mono text-xs text-accent">01</span>
            <p className="mt-1">
              Create a free workspace at{" "}
              <a className="text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink" href="https://platform.postiz.com" target="_blank" rel="noreferrer">
                Postiz
              </a>
              . It holds your social logins; we never see your passwords.
            </p>
          </li>
          <li>
            <span className="font-mono text-xs text-accent">02</span>
            <p className="mt-1">In Postiz, open Settings, then Public API, and copy the key.</p>
          </li>
          <li>
            <span className="font-mono text-xs text-accent">03</span>
            <p className="mt-1">Paste it here. We check it with Postiz before saving it, encrypted.</p>
          </li>
        </ol>
        <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-3" noValidate>
          <Field label="Postiz API key" htmlFor="postiz-key" error={error} className="min-w-[260px] flex-1">
            <TextInput id="postiz-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste the key from Postiz" aria-invalid={error ? true : undefined} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={apiKey.trim().length < 8}>
            {busy ? "Checking key…" : "Connect Postiz"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function ChannelsManager({
  connectionId,
  channels: initial,
  providers,
  checkedAt,
}: {
  connectionId: string | null;
  channels: ManagedChannel[];
  providers: ConnectableProvider[];
  checkedAt: string | null;
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initial);
  const [waiting, setWaiting] = useState<{ provider: ConnectableProvider; before: number } | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function refresh(): Promise<ManagedChannel[]> {
    if (!connectionId) return channels;
    const data = await call(`/api/postiz/connections/${connectionId}/refresh`, { method: "POST" });
    const next = (data.channels as ManagedChannel[]) ?? [];
    setChannels(next);
    return next;
  }

  // Poll Postiz while the user finishes OAuth in the other tab. The provider's
  // callback lands on Postiz, not here, so polling is how we learn it worked.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const until = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      if (cancelled) return;
      try {
        const next = await refresh();
        const count = next.filter((c) => c.identifier === waiting.provider.id).length;
        if (count > waiting.before) {
          setWaiting(null);
          setNotice(`${waiting.provider.label} is connected.`);
          router.refresh();
          return;
        }
      } catch (err) {
        setError((err as Error).message);
      }
      if (Date.now() > until) {
        setWaiting(null);
        setError(`No new ${waiting.provider.label} channel appeared. If you finished signing in, press Check again.`);
        return;
      }
      timer.current = setTimeout(tick, POLL_MS);
    };
    timer.current = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when a new wait begins
  }, [waiting]);

  async function connect(provider: ConnectableProvider, refreshId?: string) {
    setError(null);
    setNotice(null);
    setBusyProvider(refreshId ?? provider.id);
    // Open the tab inside the click so pop-up blockers allow it, then point it
    // at the provider once Postiz has issued the sign-in link.
    const tab = window.open("about:blank", "_blank");
    try {
      const q = refreshId ? `?refresh=${encodeURIComponent(refreshId)}` : "";
      const data = await call(`/api/postiz/connect/${provider.id}${q}`, { method: "POST" });
      const url = String(data.url);
      sendTo(tab, url);
      if (!refreshId) {
        const before = channels.filter((c) => c.identifier === provider.id).length;
        setWaiting({ provider, before });
      } else {
        setNotice(`Finish reconnecting ${provider.label} in the new tab, then press Check again.`);
      }
    } catch (err) {
      tab?.close();
      setError((err as Error).message);
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnect(channel: ManagedChannel) {
    if (!window.confirm(`Disconnect ${channel.name}? Scheduled posts to this channel will fail until it is connected again.`)) return;
    setBusyChannel(channel.id);
    setError(null);
    try {
      const data = await call(`/api/postiz/channels/${channel.id}`, { method: "DELETE" });
      setChannels((data.channels as ManagedChannel[]) ?? []);
      setNotice(`${channel.name} was disconnected.`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyChannel(null);
    }
  }

  async function checkNow() {
    setError(null);
    setBusyProvider("__check");
    try {
      await refresh();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyProvider(null);
    }
  }

  if (!connectionId) return <PostizKeyForm onConnected={() => router.refresh()} />;

  const connectedByProvider = new Map<string, number>();
  for (const c of channels) connectedByProvider.set(c.identifier, (connectedByProvider.get(c.identifier) ?? 0) + 1);

  return (
    <div className="space-y-6">
      {(error || notice || waiting) && (
        <div role="status" aria-live="polite" className="space-y-2">
          {waiting && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <PlatformIcon platform={waiting.provider.id} size={16} />
                Finish signing in to {waiting.provider.label} in the new tab. This page picks the channel up by itself.
              </span>
              <Button size="sm" onClick={() => setWaiting(null)}>
                Stop waiting
              </Button>
            </div>
          )}
          {notice && (
            <p className="inline-flex items-center gap-2 rounded-[10px] border border-hairline bg-accent-soft px-4 py-3 text-sm text-ink">
              <CheckCircle size={16} weight="fill" className="text-accent" /> {notice}
            </p>
          )}
          {error && (
            <p className="inline-flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <WarningCircle size={16} weight="fill" /> {error}
            </p>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title="Add a channel"
          meta="You sign in on the platform's own page"
          action={
            <Button size="sm" onClick={checkNow} loading={busyProvider === "__check"}>
              Check again
            </Button>
          }
        />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => {
              const n = connectedByProvider.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => connect(p)}
                    disabled={busyProvider !== null || waiting !== null}
                    className="group flex w-full items-center gap-3 rounded-[10px] border border-hairline bg-surface px-4 py-3 text-left motion-safe:transition-[border-color,transform] motion-safe:duration-200 hover:border-hairline-strong active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-canvas" style={{ color: platformColor(p.id) }}>
                      <PlatformIcon platform={p.id} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{busyProvider === p.id ? "Opening sign in…" : `Connect ${p.label}`}</span>
                      <span className="block text-xs text-faint">{n > 0 ? `${n} connected` : "Not connected"}</span>
                    </span>
                    <ArrowSquareOut size={16} className="text-faint group-hover:text-ink" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Connected channels" meta={checkedAt ? `Checked ${formatRelative(checkedAt)}` : undefined} />
        <CardBody>
          {channels.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Plugs size={28} className="text-faint" aria-hidden />
              <p className="text-sm font-medium">No channels yet</p>
              <p className="max-w-[40ch] text-sm text-muted">Connect TikTok, YouTube or Instagram above. Approved clips and promos can then be scheduled to them.</p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {channels.map((c) => {
                const provider = providers.find((p) => p.id === c.identifier);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="relative">
                      {c.picture ? (
                        // Channel avatars come from Postiz's CDN; sizes vary per provider.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.picture} alt="" width={36} height={36} className="h-9 w-9 rounded-full border border-hairline object-cover" />
                      ) : (
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-canvas">
                          <PlugsConnected size={16} aria-hidden />
                        </span>
                      )}
                      <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-hairline bg-surface" style={{ color: platformColor(c.identifier) }}>
                        <PlatformIcon platform={c.identifier} size={11} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-faint">{provider?.label ?? c.platform}</span>
                    </span>
                    {c.disabled ? <Pill tone="amber">Needs reconnecting</Pill> : <Pill tone="emerald">Ready</Pill>}
                    <div className="flex gap-2">
                      {provider && (
                        <Button size="sm" onClick={() => connect(provider, c.id)} loading={busyProvider === c.id} disabled={busyProvider !== null}>
                          Reconnect
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => disconnect(c)} loading={busyChannel === c.id} aria-label={`Disconnect ${c.name}`}>
                        <Trash size={14} aria-hidden /> Disconnect
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
