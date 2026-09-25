"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

const DEFAULT_INSPIRATION_URL = "https://www.youtube.com/watch?v=9sMVY15d7BA";

/**
 * Starts a 15-second promo film. Three modes, decided by two inputs:
 *   your own YouTube inspiration → its structure and motion inspire the film
 *   "use default inspiration" on → our default video inspires it instead
 *   neither                      → no video is fetched; the motion-design brief directs it
 * Screenshots are optional: switched off (or absent), the film is made from the
 * name, description and logo only.
 */
export function GeneratePromo({ productId, hasLogo, screenCount, savedInspirationUrl = "" }: { productId: string; hasLogo: boolean; screenCount: number; savedInspirationUrl?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The intake wizard can save an inspiration video; it prefills the field.
  const [url, setUrl] = useState(savedInspirationUrl);
  const [useDefault, setUseDefault] = useState(false);
  const [useScreens, setUseScreens] = useState(screenCount > 0);

  const custom = url.trim().length > 0;
  const mode = custom ? "custom" : useDefault ? "default" : "none";
  const summary = {
    custom: "Your video inspires the structure, pacing and motion. The film is original and uses only your product.",
    default: "Our default inspiration video will be fetched and used as the creative reference.",
    none: "No video is fetched. The film is directed as a motion-design showreel for your product.",
  }[mode];

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/promo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(custom ? { inspirationUrl: url.trim() } : {}), useDefaultInspiration: !custom && useDefault, useScreenshots: useScreens && screenCount > 0 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message?: string }[] };
      if (!res.ok) throw new Error(body.error && body.error !== "validation" ? body.error : body.issues?.[0]?.message ?? `Could not start the promo (${res.status}).`);
      setOpen(false);
      setUrl(savedInspirationUrl);
      setUseDefault(false);
      setUseScreens(screenCount > 0);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!hasLogo) {
    return (
      <div className="text-right">
        <Button variant="secondary" disabled>
          Generate promo film
        </Button>
        <p className="mt-1 text-[12px] text-faint">Upload a logo first</p>
      </div>
    );
  }
  const withScreens = useScreens && screenCount > 0;

  return (
    <div className="text-right">
      {!open ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Generate promo film
        </Button>
      ) : (
        <div className="flex w-[380px] max-w-[90vw] flex-col gap-4 rounded-[10px] border border-hairline bg-surface p-4 text-left shadow-[var(--shadow-raise)]">
          <div>
            <p className="text-sm font-semibold">Promo film · 15 seconds</p>
            <p className="mt-0.5 text-xs text-muted">
              Made from your logo{withScreens ? `, ${screenCount} screenshot${screenCount === 1 ? "" : "s"}` : ""}, features and brand colours.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium">
              Your inspiration video <span className="font-normal text-faint">optional</span>
            </span>
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              placeholder="https://youtube.com/watch?v=…"
              className="h-9 rounded-[8px] border border-hairline-strong bg-surface px-3 text-sm placeholder:text-faint"
            />
            <span className="text-xs text-muted">A promo whose style you like. We study it and build an original film around your product.</span>
          </label>

          <Toggle id="default-inspiration" label="Use default inspiration" on={!custom && useDefault} disabled={busy || custom} onToggle={() => setUseDefault((v) => !v)}>
            When on, we fetch{" "}
            <a href={DEFAULT_INSPIRATION_URL} target="_blank" rel="noreferrer" className="underline decoration-hairline-strong underline-offset-2 hover:decoration-ink">
              our default video
            </a>{" "}
            and use it as creative inspiration.{custom ? " Your own video is used instead." : ""}
          </Toggle>

          <Toggle id="use-screenshots" label="Use my app screenshots" on={withScreens} disabled={busy || screenCount === 0} onToggle={() => setUseScreens((v) => !v)}>
            {screenCount === 0
              ? "No screenshots uploaded, so the film is made from your name, description and logo."
              : withScreens
                ? "Your screens appear in the film."
                : "Off: no screenshots are used. The film is made from your name, description and logo."}
          </Toggle>

          <p className="rounded-[8px] bg-canvas px-3 py-2 text-xs text-muted" aria-live="polite">
            <span className="font-medium text-ink">{{ custom: "Your inspiration", default: "Default inspiration", none: "No inspiration" }[mode]}.</span> {summary}
          </p>

          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={start} loading={busy}>
              {busy ? "Starting" : "Generate"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ id, label, on, disabled, onToggle, children }: { id: string; label: string; on: boolean; disabled: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-[8px] border border-hairline p-3 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-[13px]">
        <span className="block font-medium" id={`${id}-label`}>
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{children}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={onToggle}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-hairline-strong"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
