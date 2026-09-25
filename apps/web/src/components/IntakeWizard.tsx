"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, HexChip, Select, TextArea, TextInput, Toggle } from "@/components/ui/Field";
import { FileDrop } from "@/components/FileDrop";
import { cn } from "@/components/ui/cn";

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ["Product", "Brand", "Sources", "Publishing", "Review"] as const;
const STEP_HINTS: Record<Step, string> = {
  0: "Name, features, audience",
  1: "Logo, screenshots, colours",
  2: "Reference and long-form video",
  3: "Cadence and content rules",
  4: "Check and create",
};

interface FeatureDraft { title: string; detail: string }

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function IntakeWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const setup = useRef<{
    key: string;
    payload: ReturnType<typeof buildPayload>;
    productId?: string;
    uploads: Array<{ file: File; kind: string; key: string; done: boolean }>;
    paletteQueued: boolean;
  } | null>(null);

  // 1 — product
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [features, setFeatures] = useState<FeatureDraft[]>([{ title: "", detail: "" }, { title: "", detail: "" }, { title: "", detail: "" }]);
  const [competitors, setCompetitors] = useState("");
  const [audience, setAudience] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["ios", "android"]);
  const [website, setWebsite] = useState("");
  const [appStore, setAppStore] = useState("");
  const [playStore, setPlayStore] = useState("");

  // 2 — brand
  const [logo, setLogo] = useState<File | null>(null);
  const [screens, setScreens] = useState<File[]>([]);
  const [colorsProvided, setColorsProvided] = useState(false);
  const [accent, setAccent] = useState("#4f46e5");
  const [ink, setInk] = useState("#14171a");
  const [canvas, setCanvas] = useState("#f6f5f1");
  const [ground, setGround] = useState("#0d1114");
  const [cta, setCta] = useState("Download on the App Store & Google Play");

  // 3 — sources
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceRights, setReferenceRights] = useState<"unknown" | "owned" | "licensed" | "third_party_attested">("unknown");
  const [longFormUrls, setLongFormUrls] = useState("");
  const [longFormRights, setLongFormRights] = useState<"" | "owned" | "licensed">("");
  const [channelUrl, setChannelUrl] = useState("");

  // 4 — publishing + content prefs
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [leadTime, setLeadTime] = useState(30);
  const [captionPreset, setCaptionPreset] = useState("hormozi-pop");
  const [useBrandColors, setUseBrandColors] = useState(true);
  const [titleBanner, setTitleBanner] = useState(true);
  const [broll, setBroll] = useState(false);
  const [sfx, setSfx] = useState(true);
  const [outro, setOutro] = useState(true);
  const [voice, setVoice] = useState<"" | "female" | "none">("");
  const [peoplePolicy, setPeoplePolicy] = useState<"" | "off" | "no-people" | "no-women">("");
  const [cleanSource, setCleanSource] = useState(false);
  const [clipsPerSource, setClipsPerSource] = useState(8);
  const [copyTone, setCopyTone] = useState("direct, specific, no hype");
  const [hashtags, setHashtags] = useState<"none" | "few" | "many">("few");

  const featureList = useMemo(() => features.filter((f) => f.title.trim()), [features]);

  const stepValid: Record<Step, boolean> = {
    0: name.trim().length > 0 && tagline.trim().length > 0 && category.trim().length > 0 && featureList.length > 0 && audience.trim().length > 0 && platforms.length > 0,
    1: logo !== null || screens.length > 0,
    2: !longFormUrls.trim() || longFormRights !== "",
    3: voice !== "" && peoplePolicy !== "",
    4: true,
  };

  function buildPayload() {
    const splitList = (s: string) => s.split(/[\n,|]/).map((x) => x.trim()).filter(Boolean);
    return {
      product: {
        name: name.trim(),
        tagline: tagline.trim(),
        description: description.trim() || undefined,
        category: { primary: category.trim(), tags: splitList(tags) },
        features: featureList.map((f, i) => ({ id: uuid(), title: f.title.trim(), detail: f.detail.trim() || undefined, priority: i + 1, evidenceAssetIds: [] })),
        competitors: splitList(competitors).map((n) => ({ name: n })),
        audience: { summary: audience.trim(), segments: [], painPoints: splitList(painPoints) },
        platforms,
        urls: { website: website || undefined, appStore: appStore || undefined, playStore: playStore || undefined },
      },
      brand: {
        screenshotAssetIds: [],
        otherAssetIds: [],
        palette: colorsProvided ? { ink, accent, canvas, ground, extra: [], source: "provided", inferredFrom: [] } : undefined,
        cta,
      },
      sources: {
        promoReference: referenceUrl ? { kind: "url", url: referenceUrl, rights: referenceRights } : undefined,
        longFormSourceIds: [],
        connected: channelUrl ? [{ kind: "youtube_channel", url: channelUrl, rights: "owned", autoQueue: false }] : [],
      },
      publishing: { channelIds: [], timezone, cadence: [], leadTimeMinutes: leadTime, minGapHours: 6 },
      contentPreferences: {
        captionPresetId: captionPreset,
        captionUseBrandColors: useBrandColors,
        titleBanner,
        broll,
        sfx,
        outro,
        voice,
        peoplePolicy,
        cleanSource,
        clipLengthSec: { min: 30, max: 90 },
        clipsPerSource,
        copyTone,
        hashtagStrategy: hashtags,
        languages: ["en"],
      },
      initialSources: longFormUrls.split(/\s+/).filter(Boolean).map(url => ({ url, rights: longFormRights })),
    };
  }

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setSubmitted(true);
    setup.current ??= {
      key: uuid(), payload: buildPayload(), paletteQueued: false,
      uploads: [
        ...(logo ? [{ file: logo, kind: "logo", key: uuid(), done: false }] : []),
        ...screens.map(file => ({ file, kind: "screenshot", key: uuid(), done: false })),
      ],
    };
    const pending = setup.current;
    try {
      if (!pending.productId) {
        setBusy("Creating product…");
        const res = await fetch("/api/products", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pending.key }, body: JSON.stringify(pending.payload) });
        if (!res.ok) {
          // Validation did not create anything: let the user correct the frozen form.
          // Unknown transport/server outcomes retain the key for a safe replay.
          if (res.status === 400) { setup.current = null; setSubmitted(false); }
          throw new Error((await res.json()).error ?? "Could not create the product");
        }
        pending.productId = ((await res.json()) as { product: { id: string } }).product.id;
      }
      for (const item of pending.uploads) {
        if (item.done) continue;
        setBusy(`Uploading ${item.file.name}…`);
        const fd = new FormData();
        fd.set("kind", item.kind); fd.set("file", item.file);
        const response = await fetch(`/api/products/${pending.productId}/assets`, { method: "POST", headers: { "idempotency-key": item.key }, body: fd });
        if (!response.ok) throw new Error(`Could not upload ${item.file.name}. Retry to finish setup.`);
        item.done = true;
      }
      if (!pending.payload.brand.palette && pending.uploads.length && !pending.paletteQueued) {
        setBusy("Queuing palette sampling…");
        const response = await fetch(`/api/products/${pending.productId}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "brand.palette" }) });
        if (!response.ok) throw new Error("Assets are saved, but colour sampling could not start. Retry to finish setup.");
        pending.paletteQueued = true;
      }
      router.push(`/products/${pending.productId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    } finally {
      submitting.current = false;
    }
  }


  const stepTitle: Record<Step, string> = {
    0: "What is the product?",
    1: "Brand assets",
    2: "Video sources",
    3: "Publishing & content preferences",
    4: "Review",
  };

  function moveFeature(i: number, dir: -1 | 1) {
    setFeatures((fs) => {
      const j = i + dir;
      if (j < 0 || j >= fs.length) return fs;
      const c = [...fs];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  }

  const colourRows: Array<[string, string, (s: string) => void]> = [
    ["Accent", accent, setAccent],
    ["Ink", ink, setInk],
    ["Canvas", canvas, setCanvas],
    ["Ground", ground, setGround],
  ];

  const reviewRows: Array<{ k: string; v: React.ReactNode }> = [
    { k: "Product", v: <>{name} <span className="text-muted">— {tagline}</span></> },
    { k: "Category", v: category },
    { k: "Features", v: <ol className="space-y-0.5">{featureList.map((f, i) => <li key={i}><span className="mr-2 font-mono text-[12px] tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>{f.title}</li>)}</ol> },
    { k: "Audience", v: audience },
    { k: "Platforms", v: platforms.join(", ") },
    { k: "Brand", v: <>{logo ? "Logo" : "No logo"} · {screens.length} {screens.length === 1 ? "screenshot" : "screenshots"} · colours {colorsProvided ? <span className="inline-flex gap-1 align-middle"><HexChip hex={accent} /><HexChip hex={ink} /></span> : "to be inferred"}</> },
    { k: "Sources", v: `${referenceUrl ? "Reference video" : "Library reference"} · ${longFormUrls.split(/\s+/).filter(Boolean).length} long-form URLs · ${channelUrl ? "channel connected" : "no channel"}` },
    { k: "Content", v: `voice: ${voice} · people policy: ${peoplePolicy} · captions: ${captionPreset}` },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Left rail stepper */}
      <ol className="flex gap-2 overflow-x-auto lg:sticky lg:top-[88px] lg:block lg:self-start lg:space-y-1" aria-label="Steps">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s}>
              <button
                type="button"
                disabled={i > step || busy !== null || submitted}
                onClick={() => setStep(i as Step)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left text-sm motion-safe:transition-colors disabled:cursor-default",
                  state === "current" ? "bg-surface shadow-[var(--shadow-soft)] border border-hairline" : "border border-transparent",
                  state === "done" && "hover:bg-surface",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums",
                    state === "done" ? "border-accent bg-accent text-white" : state === "current" ? "border-ink bg-ink text-white" : "border-hairline-strong text-faint",
                  )}
                >
                  {state === "done" ? (
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden>
                      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn("block font-medium", state === "todo" ? "text-muted" : "text-ink")}>{s}</span>
                  <span className="hidden text-xs text-faint lg:block">{STEP_HINTS[i as Step]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Content */}
      <div className="min-w-0">
        <section className="surface">
          <header className="border-b border-hairline px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-faint tabular-nums">Step {step + 1} of {STEPS.length}</p>
            <h2 className="mt-0.5 text-[18px] font-semibold tracking-tight">{stepTitle[step]}</h2>
          </header>

          <div className="px-6 py-6">
            {step === 0 && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor="f-name">
                    <TextInput id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Civia" autoFocus />
                  </Field>
                  <Field label="Category" htmlFor="f-category">
                    <TextInput id="f-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="education" />
                  </Field>
                </div>
                <Field label="One-line description" htmlFor="f-tagline">
                  <TextInput id="f-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Pass the US civics test with confidence" />
                </Field>
                <Field label="Full description" optional htmlFor="f-desc">
                  <TextArea id="f-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>

                <Field label="Features" hint="Most important first. Order drives what promo films and clips lead with.">
                  <ul className="space-y-2">
                    {features.map((f, i) => (
                      <li key={i} className="grid items-center gap-2 sm:grid-cols-[24px_1fr_2fr_auto]">
                        <span className="hidden font-mono text-[12px] tabular-nums text-faint sm:block">{String(i + 1).padStart(2, "0")}</span>
                        <TextInput placeholder={`Feature ${i + 1}`} value={f.title} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                        <TextInput placeholder="What it actually does (optional)" value={f.detail} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} />
                        <div className="flex gap-1">
                          <Button size="sm" className="w-8 px-0" aria-label="Move up" disabled={i === 0} onClick={() => moveFeature(i, -1)}>↑</Button>
                          <Button size="sm" className="w-8 px-0" aria-label="Move down" disabled={i === features.length - 1} onClick={() => moveFeature(i, 1)}>↓</Button>
                          <Button size="sm" variant="ghost" className="w-8 px-0" aria-label="Remove feature" onClick={() => setFeatures((fs) => fs.filter((_, j) => j !== i))}>×</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => setFeatures((fs) => [...fs, { title: "", detail: "" }])}>
                    + Add feature
                  </Button>
                </Field>

                <Field label="Target audience" htmlFor="f-audience">
                  <TextArea id="f-audience" rows={2} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Green card holders preparing for the naturalization interview" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Pain points" hint="Comma separated" htmlFor="f-pain">
                    <TextInput id="f-pain" value={painPoints} onChange={(e) => setPainPoints(e.target.value)} />
                  </Field>
                  <Field label="Competitors" hint="Comma separated" htmlFor="f-comp">
                    <TextInput id="f-comp" value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
                  </Field>
                </div>
                <Field label="Platforms">
                  <div className="flex flex-wrap gap-1.5">
                    {["ios", "android", "web", "desktop"].map((p) => {
                      const on = platforms.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setPlatforms((ps) => (on ? ps.filter((x) => x !== p) : [...ps, p]))}
                          className={cn("h-8 rounded-full border px-3 text-[13px] motion-safe:transition-colors", on ? "border-ink bg-ink text-white" : "border-hairline-strong bg-surface text-muted hover:text-ink")}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Website" optional htmlFor="f-web"><TextInput id="f-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></Field>
                  <Field label="App Store" optional htmlFor="f-ios"><TextInput id="f-ios" value={appStore} onChange={(e) => setAppStore(e.target.value)} placeholder="https://" /></Field>
                  <Field label="Play Store" optional htmlFor="f-play"><TextInput id="f-play" value={playStore} onChange={(e) => setPlayStore(e.target.value)} placeholder="https://" /></Field>
                </div>
                <Field label="Category tags" hint="Comma separated" optional htmlFor="f-tags">
                  <TextInput id="f-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <Field label="Logo" hint="PNG or SVG, square preferred.">
                  <FileDrop files={logo ? [logo] : []} onChange={(fs) => setLogo(fs[0] ?? null)} label={logo ? "Replace logo" : "Add logo"} hint="One image" />
                </Field>
                <Field label="Screenshots" hint="In the order you want them shown. Hover a tile to reorder or remove.">
                  <FileDrop files={screens} onChange={setScreens} multiple label="Add screenshots" hint={screens.length ? `${screens.length} selected` : "Portrait or landscape, any count"} previewAspect="portrait" />
                </Field>
                <Toggle checked={colorsProvided} onChange={setColorsProvided} label="I know my brand colours" hint="Otherwise they are sampled from the logo and screenshots and marked as inferred." />
                {colorsProvided ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {colourRows.map(([n, v, set]) => (
                      <label key={n} className="block cursor-pointer">
                        <span className="relative block aspect-[4/3] overflow-hidden rounded-[8px] border border-hairline" style={{ background: v }}>
                          <input type="color" value={v} onChange={(e) => set(e.target.value)} className="absolute inset-0 h-full w-full opacity-0" aria-label={`${n} colour`} />
                        </span>
                        <span className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium">{n}</span>
                          <HexChip hex={v} />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 text-xs text-muted">Colours will be sampled from the logo and screenshots and clearly marked as inferred. You can confirm or edit them afterwards.</p>
                )}
                <Field label="Call to action" htmlFor="f-cta">
                  <TextInput id="f-cta" value={cta} onChange={(e) => setCta(e.target.value)} />
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-sm text-muted">All optional. Everything here can also be added from the product page later.</p>
                <Field label="Inspiration video for the promo film" optional htmlFor="f-ref" hint="A YouTube promo whose style you like. It inspires the film’s structure and motion; nothing is copied. Leave empty to generate without one.">
                  <TextInput id="f-ref" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
                </Field>
                {referenceUrl && (
                  <Field label="Rights to the reference" htmlFor="f-ref-rights">
                    <Select id="f-ref-rights" value={referenceRights} onChange={(e) => setReferenceRights(e.target.value as typeof referenceRights)}>
                      <option value="unknown">Unknown (analysis only, no footage reuse)</option>
                      <option value="owned">I made it</option>
                      <option value="licensed">Creative Commons / licensed</option>
                      <option value="third_party_attested">I have permission from the rights holder</option>
                    </Select>
                  </Field>
                )}
                <Field label="Long-form videos to cut into shorts" optional htmlFor="f-long" hint="One YouTube URL per line. Saved to Sources; start processing there after setup.">
                  <TextArea id="f-long" rows={3} value={longFormUrls} onChange={(e) => setLongFormUrls(e.target.value)} placeholder="https://youtube.com/watch?v=…" className="font-mono text-[13px]" />
                </Field>
                {longFormUrls.trim() && <Field label="Rights for these videos" htmlFor="f-long-rights">
                  <Select id="f-long-rights" value={longFormRights} onChange={e => setLongFormRights(e.target.value as typeof longFormRights)}>
                    <option value="">Choose rights</option><option value="owned">I made these videos</option><option value="licensed">I have a licence to reuse these videos</option>
                  </Select>
                </Field>}
                <Field label="Your own YouTube channel" optional htmlFor="f-channel" hint="Saved as a source preference. Connected YouTube channels are checked daily. New videos wait for you to start processing.">
                  <TextInput id="f-channel" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@yourchannel" />
                </Field>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Timezone" htmlFor="f-tz"><TextInput id="f-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
                  <Field label="Publish lead time" hint="Minutes before the slot that the post is handed to Postiz." htmlFor="f-lead">
                    <TextInput id="f-lead" type="number" min={5} value={leadTime} onChange={(e) => setLeadTime(Number(e.target.value))} className="tabular-nums" />
                  </Field>
                </div>
                <p className="rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 text-xs text-muted">Postiz connection and channel cadence are configured on the product page after creation.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Caption preset" htmlFor="f-cap"><TextInput id="f-cap" value={captionPreset} onChange={(e) => setCaptionPreset(e.target.value)} className="font-mono text-[13px]" /></Field>
                  <Field label="Clips per source" htmlFor="f-cps"><TextInput id="f-cps" type="number" min={1} max={25} value={clipsPerSource} onChange={(e) => setClipsPerSource(Number(e.target.value))} className="tabular-nums" /></Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle checked={useBrandColors} onChange={setUseBrandColors} label="Captions use brand colours" />
                  <Toggle checked={titleBanner} onChange={setTitleBanner} label="Title banner on clips" />
                  <Toggle checked={sfx} onChange={setSfx} label="Sound design" />
                  <Toggle checked={broll} onChange={setBroll} label="B-roll enrichment" hint="Slow; uses stock footage APIs." />
                  <Toggle checked={outro} onChange={setOutro} label="Branded end card" />
                  <Toggle checked={cleanSource} onChange={setCleanSource} label="Clean source" hint="Remove burned-in captions, isolate voice." />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="End-card voice" required htmlFor="f-voice">
                    <Select id="f-voice" value={voice} onChange={(e) => setVoice(e.target.value as typeof voice)}>
                      <option value="">Choose…</option>
                      <option value="none">No voice line</option>
                      <option value="female">Natural female voice (AI-generated)</option>
                    </Select>
                  </Field>
                  <Field label="People policy" required hint="For B-roll and thumbnails." htmlFor="f-people">
                    <Select id="f-people" value={peoplePolicy} onChange={(e) => setPeoplePolicy(e.target.value as typeof peoplePolicy)}>
                      <option value="">Choose…</option>
                      <option value="off">No restriction</option>
                      <option value="no-people">Avoid footage with people</option>
                      <option value="no-women">Avoid footage showing women</option>
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Copy tone" htmlFor="f-tone"><TextInput id="f-tone" value={copyTone} onChange={(e) => setCopyTone(e.target.value)} /></Field>
                  <Field label="Hashtags" htmlFor="f-hash">
                    <Select id="f-hash" value={hashtags} onChange={(e) => setHashtags(e.target.value as typeof hashtags)}>
                      <option value="none">None</option>
                      <option value="few">A few, specific</option>
                      <option value="many">Many</option>
                    </Select>
                  </Field>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5 text-sm">
                <dl className="divide-y divide-hairline">
                  {reviewRows.map((row) => (
                    <div key={row.k} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[140px_1fr]">
                      <dt className="text-muted">{row.k}</dt>
                      <dd className="min-w-0">{row.v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="rounded-[8px] border border-hairline bg-canvas px-3 py-2.5 text-xs text-muted">Creating the product uploads the assets and, unless you provided colours, queues a palette-sampling job. Everything downstream reads from this profile; you will not be asked these questions again.</p>
              </div>
            )}
          </div>
        </section>

        {/* Sticky footer */}
        <div className="sticky bottom-0 z-10 mt-4 -mx-1 flex items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface/95 px-4 py-3 shadow-[var(--shadow-raise)] backdrop-blur-[2px]">
          <Button disabled={step === 0 || busy !== null || submitted} onClick={() => setStep((s) => (s - 1) as Step)}>
            Back
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            {!stepValid[step] && step < 4 && !error && <p className="hidden text-xs text-faint sm:block">{step === 1 ? "Add a logo or at least one screenshot" : step === 3 ? "Choose voice and people policy" : "Fill the required fields"}</p>}
            {step < 4 ? (
              <Button variant="primary" disabled={!stepValid[step]} onClick={() => setStep((s) => (s + 1) as Step)}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" disabled={busy !== null} loading={busy !== null} onClick={submit}>
                {busy ?? (submitted ? "Retry setup" : "Create product")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
