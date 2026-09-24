import Link from "next/link";

export const metadata = {
  title: "Distribution — real output",
  description: "The actual files one product profile produced: promo cuts, App Store previews, and the written creative direction.",
};

const FILMS = [
  { id: "vertical", label: "9:16 vertical", use: "Reels · TikTok · Shorts", src: "/demo/promo_vertical.mp4", poster: "/demo/poster-vertical.png", spec: "1080 × 1920 · 60fps · 24.0s", portrait: true },
  { id: "landscape", label: "16:9 landscape", use: "YouTube · site hero", src: "/demo/promo_landscape.mp4", poster: "/demo/poster-landscape.png", spec: "1920 × 1080 · 60fps · 24.0s", portrait: false },
  { id: "appstore", label: "App Store preview", use: "App Store · trimmed to Apple's rule", src: "/demo/promo_store_portrait-appstore.mp4", poster: "/demo/poster-vertical.png", spec: "886 × 1920 · 30fps · ≤30s", portrait: true },
];

const FACTS: [string, string][] = [
  ["Verified promo runs", "2"],
  ["Exports per run", "6 videos"],
  ["Branded source clips", "2"],
  ["Clip covers verified", "6"],
];

const PALETTE: [string, string][] = [
  ["#3d986a", "accent"],
  ["#091710", "ink"],
  ["#f9f6e9", "canvas"],
  ["#122037", "ground"],
];

export default function DemoPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between px-6">
          <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-canvas" />
            </span>
            Distribution
          </Link>
          <a href="https://github.com/aariz51/Distribution" className="rounded-[8px] border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium hover:border-hairline-strong">
            Source
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-6 pb-24">
        <section className="border-b border-hairline py-16">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Real output, not a mockup
          </p>
          <h1 className="max-w-[20ch] text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">What one product profile produced.</h1>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-muted">
            These files were generated from a single profile for <span className="text-ink">SafeChoice</span>, a shipped
            product-label scanner, using its real logo and screenshots. These previews come from the verified 24-second
            run. The full workflow also produced playable branded clips, covers and a clip with stock footage, sound effects and a female voice outro.
          </p>
          <dl className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-hairline bg-hairline sm:grid-cols-4">
            {FACTS.map(([k, v]) => (
              <div key={k} className="bg-surface p-5">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.02em]">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[12px] text-muted">
            <span>Palette sampled from the app icon:</span>
            {PALETTE.map(([hex, role]) => (
              <span key={role} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-1">
                <span className="h-3 w-3 rounded-[3px] border border-hairline" style={{ background: hex }} />
                <code className="font-mono text-[11px]">{hex}</code>
                <span className="text-faint">{role}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="py-16">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">The films</h2>
          <p className="mt-2 max-w-[62ch] text-muted">Three previews from six verified exports. Each format has its own composition.</p>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {FILMS.map((f) => (
              <figure key={f.id} className="overflow-hidden rounded-[10px] border border-hairline bg-surface">
                <div className={`bg-[#0b0c10] ${f.portrait ? "aspect-[9/16]" : "aspect-video"}`}>
                  {/* Muted, wordless promo cuts: there is no speech to caption. */}
                  <video className="h-full w-full object-contain" src={f.src} poster={f.poster} controls playsInline preload="metadata" />
                </div>
                <figcaption className="p-4">
                  <span className="text-[14px] font-semibold">{f.label}</span>
                  <p className="mt-0.5 text-[13px] text-muted">{f.use}</p>
                  <p className="mt-2 font-mono text-[11px] text-faint">{f.spec}</p>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-6 text-[13px] text-muted">These previews are compressed and muted for this page. The dimensions above describe the original exports.</p>
        </section>

        <section className="border-t border-hairline py-16">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">It writes down its reasoning</h2>
          <p className="mt-2 max-w-[62ch] text-muted">
            Every film ships with the direction that produced it: which structure was chosen and why, the palette and
            where each colour lands, and a beat-by-beat storyboard. It is a document you can argue with.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/demo/CREATIVE_DIRECTION.md" className="rounded-[8px] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">Read CREATIVE_DIRECTION.md</a>
            <a href="/demo/storyboard.json" className="rounded-[8px] border border-hairline bg-surface px-4 py-2 text-sm font-medium hover:border-hairline-strong">View the storyboard JSON</a>
          </div>
        </section>

        <section className="border-t border-hairline py-16">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Running the whole app</h2>
          <p className="mt-2 max-w-[62ch] text-muted">
            The pages above are static. The app itself — intake, library, approvals, scheduling — needs a Postgres
            database and a worker with ffmpeg, Python and a headless Chromium, so it runs on your own machine rather
            than on this host.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-[10px] border border-hairline bg-surface p-5 font-mono text-[12px] leading-relaxed text-muted">
{`git clone https://github.com/aariz51/Distribution
cd Distribution
createdb distribution
cp .env.example .env
pnpm install && pnpm --filter @distribution/db migrate
pnpm --filter @distribution/web dev        # the app
pnpm --filter @distribution/worker start   # the pipelines

# configure providers and runtime dependencies as described in README.md;
# then generate a promo from a saved profile:
pnpm exec tsx scripts/run-promo.ts <productId> 24`}
          </pre>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-[12px] text-faint">
          <span>Distribution</span>
          <p>Real SafeChoice outputs · verified end to end.</p>
        </div>
      </footer>
    </div>
  );
}
