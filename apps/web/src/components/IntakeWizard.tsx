"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ["Product", "Brand", "Sources", "Publishing", "Review"] as const;

interface FeatureDraft { title: string; detail: string }

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function IntakeWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const [voice, setVoice] = useState<"" | "clone" | "none">("");
  const [peoplePolicy, setPeoplePolicy] = useState<"" | "off" | "no-people" | "no-women">("");
  const [cleanSource, setCleanSource] = useState(false);
  const [clipsPerSource, setClipsPerSource] = useState(8);
  const [copyTone, setCopyTone] = useState("direct, specific, no hype");
  const [hashtags, setHashtags] = useState<"none" | "few" | "many">("few");

  const featureList = useMemo(() => features.filter((f) => f.title.trim()), [features]);

  const stepValid: Record<Step, boolean> = {
    0: name.trim().length > 0 && tagline.trim().length > 0 && category.trim().length > 0 && featureList.length > 0 && audience.trim().length > 0 && platforms.length > 0,
    1: logo !== null || screens.length > 0,
    2: true,
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
      // long-form URLs are ingested as source rows after the product exists
      _longFormUrls: longFormUrls.split(/\s+/).filter(Boolean),
    };
  }

  async function submit() {
    setError(null);
    setBusy("Creating product…");
    try {
      const payload = buildPayload();
      const { _longFormUrls, ...profile } = payload;
      void _longFormUrls; // Phase 2 wires these into source ingestion
      const res = await fetch("/api/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
      if (!res.ok) throw new Error((await res.json()).error ?? "create failed");
      const { product } = (await res.json()) as { product: { id: string } };
      const upload = async (file: File, kind: string) => {
        const fd = new FormData();
        fd.set("kind", kind);
        fd.set("file", file);
        const r = await fetch(`/api/products/${product.id}/assets`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(`upload failed: ${file.name}`);
      };
      if (logo) {
        setBusy("Uploading logo…");
        await upload(logo, "logo");
      }
      for (const [i, s] of screens.entries()) {
        setBusy(`Uploading screenshot ${i + 1}/${screens.length}…`);
        await upload(s, "screenshot");
      }
      if (!colorsProvided && (logo || screens.length)) {
        setBusy("Queuing palette sampling…");
        await fetch(`/api/products/${product.id}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "brand.palette" }) });
      }
      router.push(`/products/${product.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const input = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
  const label = "block text-sm text-zinc-700";

  return (
    <div className="mx-auto max-w-3xl">
      <ol className="mb-8 flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 ${i === step ? "text-zinc-900" : "text-zinc-400"}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${i <= step ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>{i + 1}</span>
            {s}
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-zinc-200" />}
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">What is the product?</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>Name<input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Civia" /></label>
              <label className={label}>Category<input className={input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="education" /></label>
            </div>
            <label className={label}>One-line description<input className={input} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Pass the US civics test with confidence" /></label>
            <label className={label}>Full description <span className="text-zinc-400">(optional)</span><textarea className={input} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <div>
              <p className={label}>Features, most important first</p>
              <ul className="mt-1 space-y-2">
                {features.map((f, i) => (
                  <li key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <input className={input + " mt-0"} placeholder={`Feature ${i + 1}`} value={f.title} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                    <input className={input + " mt-0"} placeholder="What it actually does (optional)" value={f.detail} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} />
                    <div className="flex gap-1">
                      <button type="button" disabled={i === 0} onClick={() => setFeatures((fs) => { const c = [...fs]; [c[i - 1], c[i]] = [c[i]!, c[i - 1]!]; return c; })} className="rounded border px-2 text-xs disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => setFeatures((fs) => fs.filter((_, j) => j !== i))} className="rounded border px-2 text-xs">✕</button>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setFeatures((fs) => [...fs, { title: "", detail: "" }])} className="mt-2 text-xs text-zinc-600 underline">Add feature</button>
            </div>
            <label className={label}>Target audience<textarea className={input} rows={2} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Green card holders preparing for the naturalization interview" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>Pain points <span className="text-zinc-400">(comma separated)</span><input className={input} value={painPoints} onChange={(e) => setPainPoints(e.target.value)} /></label>
              <label className={label}>Competitors <span className="text-zinc-400">(comma separated)</span><input className={input} value={competitors} onChange={(e) => setCompetitors(e.target.value)} /></label>
            </div>
            <div>
              <p className={label}>Platforms</p>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {["ios", "android", "web", "desktop"].map((p) => (
                  <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms((ps) => (e.target.checked ? [...ps, p] : ps.filter((x) => x !== p)))} />{p}</label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className={label}>Website<input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></label>
              <label className={label}>App Store<input className={input} value={appStore} onChange={(e) => setAppStore(e.target.value)} placeholder="https://" /></label>
              <label className={label}>Play Store<input className={input} value={playStore} onChange={(e) => setPlayStore(e.target.value)} placeholder="https://" /></label>
            </div>
            <label className={label}>Category tags <span className="text-zinc-400">(comma separated)</span><input className={input} value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Brand assets</h2>
            <label className={label}>Logo (PNG/SVG, square preferred)
              <input type="file" accept="image/*" className="mt-1 block text-sm" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
            </label>
            <label className={label}>Screenshots (in the order you want them shown)
              <input type="file" accept="image/*" multiple className="mt-1 block text-sm" onChange={(e) => setScreens(Array.from(e.target.files ?? []))} />
              {screens.length > 0 && <span className="mt-1 block text-xs text-zinc-500">{screens.length} selected</span>}
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={colorsProvided} onChange={(e) => setColorsProvided(e.target.checked)} />I know my brand colours</label>
            {colorsProvided ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Accent", accent, setAccent], ["Ink", ink, setInk], ["Canvas", canvas, setCanvas], ["Ground", ground, setGround]].map(([n, v, set]) => (
                  <label key={n as string} className="text-xs text-zinc-600">{n as string}
                    <div className="mt-1 flex items-center gap-2"><input type="color" value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)} /><code>{v as string}</code></div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">Colours will be sampled from the logo and screenshots and clearly marked as inferred. You can confirm or edit them afterwards.</p>
            )}
            <label className={label}>Call to action<input className={input} value={cta} onChange={(e) => setCta(e.target.value)} /></label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Video sources <span className="text-sm font-normal text-zinc-500">(all optional)</span></h2>
            <label className={label}>Reference / inspiration video for the promo film
              <input className={input} value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              <span className="mt-1 block text-xs text-zinc-500">Used only as a motion-language reference; nothing is copied. Leave empty to pick from the curated reference library.</span>
            </label>
            {referenceUrl && (
              <label className={label}>Rights to the reference
                <select className={input} value={referenceRights} onChange={(e) => setReferenceRights(e.target.value as typeof referenceRights)}>
                  <option value="unknown">Unknown (analysis only, no footage reuse)</option>
                  <option value="owned">I made it</option>
                  <option value="licensed">Creative Commons / licensed</option>
                  <option value="third_party_attested">I have permission from the rights holder</option>
                </select>
              </label>
            )}
            <label className={label}>Long-form videos to cut into shorts <span className="text-zinc-400">(one URL per line)</span>
              <textarea className={input} rows={3} value={longFormUrls} onChange={(e) => setLongFormUrls(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              <span className="mt-1 block text-xs text-zinc-500">Each URL is probed for licence and rights before anything is downloaded. Uploads are added from the product page.</span>
            </label>
            <label className={label}>Your own YouTube channel <span className="text-zinc-400">(new uploads become clip sources)</span>
              <input className={input} value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@yourchannel" />
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Publishing &amp; content preferences</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>Timezone<input className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
              <label className={label}>Publish lead time (minutes)<input type="number" min={5} className={input} value={leadTime} onChange={(e) => setLeadTime(Number(e.target.value))} /></label>
            </div>
            <p className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">Postiz connection and channel cadence are configured on the product page after creation (Phase 3).</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>Caption preset<input className={input} value={captionPreset} onChange={(e) => setCaptionPreset(e.target.value)} /></label>
              <label className={label}>Clips per source<input type="number" min={1} max={25} className={input} value={clipsPerSource} onChange={(e) => setClipsPerSource(Number(e.target.value))} /></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={useBrandColors} onChange={(e) => setUseBrandColors(e.target.checked)} />Captions use brand colours</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={titleBanner} onChange={(e) => setTitleBanner(e.target.checked)} />Title banner on clips</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sfx} onChange={(e) => setSfx(e.target.checked)} />Sound design</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={broll} onChange={(e) => setBroll(e.target.checked)} />B-roll enrichment (slow, uses stock footage APIs)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={outro} onChange={(e) => setOutro(e.target.checked)} />Branded end card</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cleanSource} onChange={(e) => setCleanSource(e.target.checked)} />Clean source (remove burned-in captions, isolate voice)</label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>End-card voice <span className="text-red-500">*</span>
                <select className={input} value={voice} onChange={(e) => setVoice(e.target.value as typeof voice)}>
                  <option value="">Choose…</option>
                  <option value="none">No voice line</option>
                  <option value="clone">Clone the speaker&apos;s voice from the clip</option>
                </select>
              </label>
              <label className={label}>People policy for B-roll and thumbnails <span className="text-red-500">*</span>
                <select className={input} value={peoplePolicy} onChange={(e) => setPeoplePolicy(e.target.value as typeof peoplePolicy)}>
                  <option value="">Choose…</option>
                  <option value="off">No restriction</option>
                  <option value="no-people">Avoid footage with people</option>
                  <option value="no-women">Avoid footage showing women</option>
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>Copy tone<input className={input} value={copyTone} onChange={(e) => setCopyTone(e.target.value)} /></label>
              <label className={label}>Hashtags
                <select className={input} value={hashtags} onChange={(e) => setHashtags(e.target.value as typeof hashtags)}>
                  <option value="none">None</option><option value="few">A few, specific</option><option value="many">Many</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 text-sm">
            <h2 className="text-lg font-semibold">Review</h2>
            <dl className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <dt className="text-zinc-500">Product</dt><dd>{name} — {tagline}</dd>
              <dt className="text-zinc-500">Category</dt><dd>{category}</dd>
              <dt className="text-zinc-500">Features</dt><dd><ol className="list-decimal pl-4">{featureList.map((f, i) => <li key={i}>{f.title}</li>)}</ol></dd>
              <dt className="text-zinc-500">Audience</dt><dd>{audience}</dd>
              <dt className="text-zinc-500">Brand</dt><dd>{logo ? "logo" : "no logo"}, {screens.length} screenshots, colours {colorsProvided ? "provided" : "to be inferred"}</dd>
              <dt className="text-zinc-500">Sources</dt><dd>{referenceUrl ? "reference video" : "library reference"}; {longFormUrls.split(/\s+/).filter(Boolean).length} long-form URLs; {channelUrl ? "channel connected" : "no channel"}</dd>
              <dt className="text-zinc-500">Content</dt><dd>voice: {voice}; people policy: {peoplePolicy}; captions: {captionPreset}</dd>
            </dl>
            <p className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">Creating the product uploads the assets and, unless you provided colours, queues a palette-sampling job. Everything downstream reads from this profile; you will not be asked these questions again.</p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-between">
          <button type="button" disabled={step === 0 || busy !== null} onClick={() => setStep((s) => (s - 1) as Step)} className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-40">Back</button>
          {step < 4 ? (
            <button type="button" disabled={!stepValid[step]} onClick={() => setStep((s) => (s + 1) as Step)} className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40">Continue</button>
          ) : (
            <button type="button" disabled={busy !== null} onClick={submit} className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ?? "Create product"}</button>
          )}
        </div>
      </section>
    </div>
  );
}
