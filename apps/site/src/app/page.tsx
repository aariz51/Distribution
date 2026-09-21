import Link from "next/link";

// Inlined rather than imported: this site shares no packages with the app, so
// it can be deployed on its own.
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-canvas" />
      </span>
      Distribution
    </span>
  );
}


export const metadata = {
  title: "Distribution — one product profile, every cut",
  description:
    "Describe your product once. Distribution turns it into a launch film, a stream of short clips, thumbnails, per-platform copy and a publishing schedule.",
};

const OUTPUTS = [
  {
    title: "Launch film",
    detail: "Four cuts from one storyboard: 9:16, 16:9 and both App Store preview sizes, trimmed to Apple's 30-second rule.",
    meta: "Remotion · 60fps",
  },
  {
    title: "Short clips",
    detail: "Long-form video becomes vertical clips, cropped to follow the speaker, captioned in your brand colours.",
    meta: "ffmpeg · face tracking",
  },
  {
    title: "Thumbnails",
    detail: "The cleanest frame of each clip, composed with your logo, palette and a headline drawn from what was actually said.",
    meta: "1080 × 1350",
  },
  {
    title: "Platform copy",
    detail: "Hook, title, caption, hashtags and CTA written per platform against that platform's real limits.",
    meta: "5 platforms",
  },
  {
    title: "A schedule",
    detail: "Approved work lands on a calendar and publishes through Postiz, with per-platform status and retries.",
    meta: "Postiz",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Describe the product once",
    body: "Name, one-line description, features in priority order, audience, logo and screenshots. If you do not know your brand colours, they are sampled from your own assets and marked as inferred until you confirm them.",
  },
  {
    n: "02",
    title: "Point it at a source",
    body: "A YouTube link or an upload for clips; optionally a reference film whose motion language you want the promo to borrow. Every source records who owns it before a byte is downloaded.",
  },
  {
    n: "03",
    title: "Review, then publish",
    body: "Everything arrives in one library as draft work waiting for a yes. Approve what is good, reject what is not, schedule the rest.",
  },
];

const PIPELINE = [
  "ingest",
  "transcribe",
  "rank moments",
  "cut 9:16",
  "captions",
  "title",
  "thumbnail",
  "copy",
  "schedule",
  "publish",
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between px-6">
          <Wordmark />
          <nav className="flex items-center gap-1 text-sm">
            <a href="#how" className="rounded-[6px] px-3 py-1.5 text-muted hover:bg-surface hover:text-ink">
              How it works
            </a>
            <Link
              href="/demo"
              className="rounded-[8px] bg-accent px-3.5 py-1.5 font-medium text-white motion-safe:transition-colors motion-safe:duration-150 hover:bg-accent-hover"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-6">
        {/* Hero */}
        <section className="border-b border-hairline py-20 sm:py-28">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            One profile in. Everything out.
          </p>
          <h1 className="max-w-[16ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[60px]">
            Describe your product <span className="text-accent">once</span>.
          </h1>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-muted">
            Making a launch film and cutting shorts are two separate jobs, with two separate intakes, and nothing ties
            either of them to a publishing schedule. Distribution makes them one job: a single product profile that
            every generator reads, and a single library where the work waits for your approval.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/demo"
              className="rounded-[8px] bg-accent px-5 py-2.5 text-sm font-medium text-white motion-safe:transition-colors motion-safe:duration-150 hover:bg-accent-hover"
            >
              Open the app
            </Link>
            <a
              href="#outputs"
              className="rounded-[8px] border border-hairline bg-surface px-5 py-2.5 text-sm font-medium motion-safe:transition-colors motion-safe:duration-150 hover:border-hairline-strong"
            >
              See what it makes
            </a>
          </div>

          {/* The pipeline, stated plainly rather than illustrated with a stock graphic. */}
          <div className="mt-14 overflow-hidden rounded-[10px] border border-hairline bg-surface">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">one source video</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">published posts</span>
            </div>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 p-4">
              {PIPELINE.map((stage, i) => (
                <li key={stage} className="flex items-center gap-2">
                  <span className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] text-muted">{stage}</span>
                  {i < PIPELINE.length - 1 && (
                    <span className="text-faint" aria-hidden>
                      ·
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Outputs */}
        <section id="outputs" className="border-b border-hairline py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">What one profile produces</h2>
          <p className="mt-2 max-w-[62ch] text-muted">
            Each of these reads the same profile, so your logo, palette, feature priority and audience reach the film,
            the clips, the thumbnails and the copy without being typed again.
          </p>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
            {OUTPUTS.map((o) => (
              <li key={o.title} className="flex flex-col bg-surface p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">{o.title}</h3>
                  <span className="font-mono text-[11px] text-faint">{o.meta}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{o.detail}</p>
              </li>
            ))}
            <li className="flex flex-col justify-center bg-surface p-6">
              <p className="text-sm leading-relaxed text-muted">
                Nothing publishes itself. Every asset arrives in <span className="text-ink">review</span> and waits.
              </p>
            </li>
          </ul>
        </section>

        {/* How */}
        <section id="how" className="border-b border-hairline py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">How it works</h2>
          <ol className="mt-10 grid gap-10 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="font-mono text-[13px] text-accent">{s.n}</span>
                <h3 className="mt-3 text-[15px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Honest engineering section — this is a tool for people who will ask. */}
        <section className="border-b border-hairline py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Built on pipelines that already worked</h2>
          <p className="mt-2 max-w-[62ch] text-muted">
            The clip pipeline and the film pipeline are not new code written to look impressive. They are the working
            implementations, moved behind a job queue so they can run unattended and be watched while they do.
          </p>
          <dl className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-hairline bg-hairline sm:grid-cols-3">
            {[
              ["Speaker-aware crop", "A face tracker plans the 9:16 window so a clip never renders an empty chair. If it cannot see a face, it falls back to a centre crop rather than failing."],
              ["Captions without drawtext", "Captions are rasterised and composited as an overlay, so they work on any ffmpeg build, and they carry your brand colours."],
              ["Long jobs, visible", "Every stage reports progress, retries what is safe to retry, and records which step failed and why."],
            ].map(([t, d]) => (
              <div key={t} className="bg-surface p-6">
                <dt className="text-[15px] font-semibold">{t}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="py-20">
          <div className="rounded-[10px] border border-hairline bg-surface p-10 text-center">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Start with the profile</h2>
            <p className="mx-auto mt-2 max-w-[48ch] text-muted">
              It takes about ten minutes. Everything after it runs without asking you the same question twice.
            </p>
            <Link
              href="/demo"
              className="mt-7 inline-block rounded-[8px] bg-accent px-5 py-2.5 text-sm font-medium text-white motion-safe:transition-colors motion-safe:duration-150 hover:bg-accent-hover"
            >
              Open the app
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-[12px] text-faint">
          <Wordmark />
          <p>Promo films and short-form clips from one product profile.</p>
        </div>
      </footer>
    </div>
  );
}
