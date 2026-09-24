"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProductProfileInput, type ProductProfile, type ContentPreferences } from "@distribution/core";
import { Button, ButtonLink } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Checkbox, Field, Select, TextArea, TextInput } from "./ui/Field";

/** Overlay edited keys on the latest profile so uploads and source additions survive a save. */
function changed<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(Object.keys(after).filter(key => JSON.stringify(before[key as keyof T]) !== JSON.stringify(after[key as keyof T])).map(key => [key, after[key as keyof T]])) as Partial<T>;
}

export function ProductEditor({ initial, captionPresets }: { initial: ProductProfile; captionPresets: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [info, setInfo] = useState(initial.product);
  const [prefs, setPrefs] = useState(initial.contentPreferences);
  const [cta, setCta] = useState(initial.brand.cta);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const updatePref = <K extends keyof ContentPreferences>(key: K, value: ContentPreferences[K]) => setPrefs(previous => ({ ...previous, [key]: value }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (prefs.clipLengthSec.min > prefs.clipLengthSec.max) throw new Error("Minimum clip length must be less than or equal to the maximum.");
      const response = await fetch(`/api/products/${initial.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the latest product. Your changes are still here; try again.");
      const { product: latest } = await response.json() as { product: ProductProfile };
      if (latest.version !== initial.version) throw new Error("This product was edited in another session. Reload this page before saving to avoid overwriting those changes.");
      const input = ProductProfileInput.safeParse({
        ...latest,
        product: {
          ...latest.product,
          ...changed(initial.product, info),
          category: { ...latest.product.category, ...changed(initial.product.category, info.category) },
          audience: { ...latest.product.audience, ...changed(initial.product.audience, info.audience) },
          urls: { ...latest.product.urls, ...changed(initial.product.urls, info.urls) },
        },
        brand: { ...latest.brand, ...(cta !== initial.brand.cta ? { cta } : {}) },
        contentPreferences: { ...latest.contentPreferences, ...changed(initial.contentPreferences, prefs) },
      });
      if (!input.success) throw new Error(input.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      const result = await fetch(`/api/products/${initial.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input.data, expectedVersion: latest.version, expectedUpdatedAt: latest.updatedAt }) });
      if (!result.ok) {
        const body = await result.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ? `Could not save: ${body.error}` : "Could not save this product. Try again.");
      }
      router.push(`/products/${initial.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this product. Try again.");
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-6 max-w-3xl space-y-6">
      <fieldset disabled={busy} className="space-y-6">
        <Card>
          <CardHeader title="Product details" />
          <CardBody className="space-y-4">
            <Field label="Product name" htmlFor="edit-name" required><TextInput id="edit-name" required maxLength={80} value={info.name} onChange={event => setInfo({ ...info, name: event.target.value })} /></Field>
            <Field label="Tagline" htmlFor="edit-tagline" required><TextInput id="edit-tagline" required maxLength={160} value={info.tagline} onChange={event => setInfo({ ...info, tagline: event.target.value })} /></Field>
            <Field label="Description" htmlFor="edit-description"><TextArea id="edit-description" rows={4} maxLength={4000} value={info.description ?? ""} onChange={event => setInfo({ ...info, description: event.target.value })} /></Field>
            <Field label="Category" htmlFor="edit-category" required><TextInput id="edit-category" required maxLength={80} value={info.category.primary} onChange={event => setInfo({ ...info, category: { ...info.category, primary: event.target.value } })} /></Field>
            <Field label="Audience" htmlFor="edit-audience" required><TextArea id="edit-audience" rows={3} required maxLength={600} value={info.audience.summary} onChange={event => setInfo({ ...info, audience: { ...info.audience, summary: event.target.value } })} /></Field>
            {(["website", "appStore", "playStore"] as const).map((key, index) => (
              <Field key={key} label={["Website", "App Store URL", "Google Play URL"][index]} htmlFor={`edit-${key}`} optional><TextInput id={`edit-${key}`} type="url" value={info.urls[key] ?? ""} onChange={event => setInfo({ ...info, urls: { ...info.urls, [key]: event.target.value || undefined } })} /></Field>
            ))}
            <Field label="Call to action" htmlFor="edit-cta"><TextInput id="edit-cta" maxLength={80} value={cta} onChange={event => setCta(event.target.value)} /></Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Content preferences" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Clips per source" htmlFor="edit-count"><TextInput id="edit-count" type="number" min={1} max={25} required value={prefs.clipsPerSource} onChange={event => updatePref("clipsPerSource", Number(event.target.value))} /></Field>
              <Field label="Minimum clip length (seconds)" htmlFor="edit-min"><TextInput id="edit-min" type="number" min={5} max={180} required value={prefs.clipLengthSec.min} onChange={event => updatePref("clipLengthSec", { ...prefs.clipLengthSec, min: Number(event.target.value) })} /></Field>
              <Field label="Maximum clip length (seconds)" htmlFor="edit-max"><TextInput id="edit-max" type="number" min={10} max={180} required value={prefs.clipLengthSec.max} onChange={event => updatePref("clipLengthSec", { ...prefs.clipLengthSec, max: Number(event.target.value) })} /></Field>
            </div>
            <Field label="Caption preset" htmlFor="edit-preset"><Select id="edit-preset" required value={prefs.captionPresetId} onChange={event => updatePref("captionPresetId", event.target.value)}>{!captionPresets.some(preset => preset.id === prefs.captionPresetId) && <option value={prefs.captionPresetId}>{prefs.captionPresetId} (saved preset)</option>}{captionPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</Select></Field>
            <Field label="End-card voice" htmlFor="edit-voice"><Select id="edit-voice" value={prefs.voice} onChange={event => updatePref("voice", event.target.value as "female" | "none")}><option value="none">No voice line</option><option value="female">Natural female voice (AI-generated)</option></Select></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["captionUseBrandColors", "Use brand colours in captions"], ["titleBanner", "Title banner"],
                ["broll", "B-roll enrichment"], ["sfx", "Sound effects"], ["outro", "End card"], ["cleanSource", "Clean source"],
              ] as const).map(([key, label]) => <Checkbox key={key} label={label} checked={prefs[key]} onChange={value => updatePref(key, value)} />)}
            </div>
            <Field label="Copy tone" htmlFor="edit-tone"><TextInput id="edit-tone" maxLength={200} value={prefs.copyTone} onChange={event => updatePref("copyTone", event.target.value)} /></Field>
            <Field label="Hashtags" htmlFor="edit-hashtags"><Select id="edit-hashtags" value={prefs.hashtagStrategy} onChange={event => updatePref("hashtagStrategy", event.target.value as ContentPreferences["hashtagStrategy"])}><option value="none">None</option><option value="few">A few</option><option value="many">Many</option></Select></Field>
          </CardBody>
        </Card>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={busy}>Save changes</Button>
        {!busy && <ButtonLink href={`/products/${initial.id}`}>Cancel</ButtonLink>}
      </div>
    </form>
  );
}
