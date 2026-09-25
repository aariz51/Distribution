import { AspectMorph } from "./AspectMorph";
import { InView, Reveal } from "./Reveal";

// The real storyboard behind the LabelWise film: scene kinds and lengths in
// frames at 60fps (storage/promo/1d2512c8…/storyboard.json), drawn to scale.
// It was directed from the name, description and logo alone; no screenshots.
const SCENES = [
  { kind: "Slam", frames: 72 },
  { kind: "Morph", frames: 144 },
  { kind: "Type", frames: 84 },
  { kind: "Cards", frames: 120 },
  { kind: "Tap", frames: 72 },
  { kind: "Dive", frames: 78 },
  { kind: "Steps", frames: 108 },
  { kind: "Beat", frames: 78 },
  { kind: "Logo", frames: 144 },
];
const TOTAL = SCENES.reduce((n, s) => n + s.frames, 0);

const POINTS = [
  { title: "Directed, not templated", body: "Each scene is written from your profile and a motion-design brief, or from a YouTube video whose style you like." },
  { title: "Your colours, your logo", body: "Sampled from your own assets when you do not have a palette. You can correct them before anything renders." },
  { title: "Every size you need", body: "Vertical and landscape at 60 fps, plus both App Store preview sizes, each with a cover image." },
];

export function PromoSection() {
  return (
    <section id="promo" aria-labelledby="promo-title" className="scroll-mt-24 border-t border-hairline bg-surface px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Promo films</p>
          <h2 id="promo-title" className="mt-4 max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            A 15-second launch film, directed for you.
          </h2>
          <p className="mt-4 max-w-[600px] text-lg text-muted text-pretty">
            Give it your logo, your app&apos;s name and what it does. Screenshots are optional. Distribution directs the film and renders every cut a feed or store asks for.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 items-center gap-12 lg:grid-cols-[6fr_5fr]">
          <Reveal>
            <AspectMorph />
          </Reveal>

          <div className="space-y-10">
              {/* Inputs → storyboard: the actual scene plan, drawn to scale. */}
              <InView className="rounded-2xl border border-hairline bg-canvas p-5 sm:p-6" threshold={0.3}>
                <div className="flex min-w-0 items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/showcase/labelwise-icon.webp" alt="" width={64} height={64} className="h-14 w-14 shrink-0 rounded-xl border border-hairline sm:h-16 sm:w-16" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">LabelWise</p>
                    <p className="truncate text-xs text-muted">Scan a product label and LabelWise reads the ingredients for you.</p>
                  </div>
                  <span className="ml-auto shrink-0 font-mono text-xs text-faint max-sm:hidden">name · logo · no screens</span>
                </div>
                <div className="relative mt-5">
                  <div className="flex h-12 gap-1 overflow-hidden rounded-lg">
                    {SCENES.map((s, i) => (
                      <div key={i} className="relative h-full overflow-hidden rounded-md bg-hairline" style={{ flexGrow: s.frames, flexBasis: 0 }}>
                        <div className="scene-fill absolute inset-0 bg-ink" style={{ ["--at" as string]: `${i * 160}ms` }} />
                        <span className="relative block truncate px-1.5 pt-1.5 text-xs font-semibold text-canvas mix-blend-difference" title={s.kind}>{s.kind}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-y-[-6px] left-0 right-0 overflow-hidden">
                    <div className="playhead h-full w-full" style={{ animationDuration: `${TOTAL / 60}s` }}>
                      <span className="block h-full w-0.5 rounded-full bg-accent" />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between font-mono text-xs text-faint">
                  <span>storyboard · {SCENES.length} scenes</span>
                  <span>{TOTAL} frames</span>
                </div>
              </InView>

            <ol className="space-y-5">
              {POINTS.map(({ title, body }, i) => (
                <Reveal as="li" key={title} delay={i * 80} className="grid grid-cols-[32px_1fr] gap-x-3">
                  <span className="font-mono text-sm text-accent">0{i + 1}</span>
                  <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted text-pretty">{body}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
