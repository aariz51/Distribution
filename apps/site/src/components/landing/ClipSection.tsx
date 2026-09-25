import { AutoVideo } from "./AutoVideo";
import { InView, Reveal } from "./Reveal";
import { CropLab } from "./CropLab";
import { CoverFan } from "./CoverFan";

// The real run behind the clip on this page: a 454.1 s source, twelve ranked
// candidate moments, the top two cut into clips (candidates table, project 69aac6bd).
const SOURCE_SEC = 454.1;
const CANDIDATES = [
  { rank: 1, start: 400.8, end: 434.7, score: 0.98, title: "Chicken meat injected with saline" },
  { rank: 2, start: 57.6, end: 88.2, score: 0.95, title: "Sixty three percent prefer natural labels" },
  { rank: 3, start: 0.8, end: 31.9, score: 0.92 },
  { rank: 4, start: 276.7, end: 327.6, score: 0.9 },
  { rank: 5, start: 314.1, end: 345.7, score: 0.88 },
  { rank: 6, start: 23.3, end: 57.0, score: 0.87 },
  { rank: 7, start: 368.1, end: 400.8, score: 0.85 },
  { rank: 8, start: 75.0, end: 109.1, score: 0.84 },
  { rank: 9, start: 170.5, end: 205.9, score: 0.81 },
  { rank: 10, start: 215.6, end: 257.2, score: 0.79 },
  { rank: 11, start: 114.5, end: 144.8, score: 0.78 },
  { rank: 12, start: 131.2, end: 165.1, score: 0.77 },
];

// A deterministic speech envelope for the timeline; it is a drawing of audio,
// not a measurement, so it is decorative and hidden from assistive technology.
const BARS = Array.from({ length: 140 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.61) * 0.6 + Math.sin(i * 0.17 + 1.3) * 0.35 + Math.sin(i * 2.3) * 0.12);
  return 0.18 + Math.min(1, v) * 0.82;
});

const pct = (s: number) => `${(s / SOURCE_SEC) * 100}%`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function ClipSection() {
  const chosen = CANDIDATES.filter((c) => c.rank <= 2);
  return (
    <section id="clips" aria-labelledby="clips-title" className="scroll-mt-24 px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Clipping</p>
          <h2 id="clips-title" className="mt-4 max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Long video in. Clips worth posting out.
          </h2>
          <p className="mt-4 max-w-[600px] text-lg text-muted text-pretty">
            Upload a talk or a podcast, or paste a YouTube link you have the rights to. Distribution transcribes every word, ranks the moments that stand on
            their own and cuts each one to vertical, ready to post.
          </p>
        </Reveal>

        {/* The source, to scale, with every moment it considered. */}
        <InView className="mt-12 rounded-2xl border border-hairline bg-surface p-5 sm:p-6" threshold={0.3}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">Natural food · source video</p>
            <p className="font-mono text-xs text-faint">{mmss(SOURCE_SEC)} · {CANDIDATES.length} moments ranked · top 2 cut</p>
          </div>

          <div className="relative mt-5">
            <svg viewBox="0 0 700 80" preserveAspectRatio="none" className="h-20 w-full" aria-hidden>
              {BARS.map((h, i) => (
                <rect key={i} x={i * 5 + 1} y={40 - h * 36} width={3} height={h * 72} rx={1.5} className="wave-bar fill-hairline-strong" style={{ animationDelay: `${(i % 12) * 0.12}s` }} />
              ))}
            </svg>
            {/* Candidate spans. The two that became clips are solid. */}
            {CANDIDATES.map((c) => (
              <div
                key={c.rank}
                className={`moment absolute top-0 h-20 rounded-md ${c.rank <= 2 ? "border-2 border-accent bg-accent/15" : "border border-dashed border-faint/60"}`}
                style={{ left: pct(c.start), width: pct(c.end - c.start), ["--at" as string]: `${300 + c.rank * 110}ms`, zIndex: c.rank <= 2 ? 2 : 1 }}
              >
                {c.rank <= 2 && (
                  <span className="absolute -top-3 left-1 rounded-full bg-accent px-2 text-xs font-semibold leading-5 text-white">#{c.rank}</span>
                )}
              </div>
            ))}
            <div className="pointer-events-none absolute inset-y-[-4px] left-0 right-0 overflow-hidden">
              <div className="playhead h-full w-full">
                <span className="block h-full w-0.5 rounded-full bg-ink" />
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-between font-mono text-xs text-faint">
            <span>0:00</span>
            <span>{mmss(SOURCE_SEC)}</span>
          </div>

          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {chosen.map((c) => (
              <li key={c.rank} className="moment flex items-center gap-3 rounded-xl border border-hairline bg-canvas px-4 py-3" style={{ ["--at" as string]: `${900 + c.rank * 200}ms` }}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">#{c.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.title}</span>
                  <span className="block font-mono text-xs text-faint">
                    {mmss(c.start)} to {mmss(c.end)} · score {c.score.toFixed(2)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </InView>

        <Reveal className="mt-16">
          <h3 className="text-2xl font-semibold tracking-tight">Cropped to vertical, captioned word by word.</h3>
          <p className="mt-2 max-w-[560px] text-base text-muted text-pretty">
            The crop keeps the subject in frame, and each word lights up as it is spoken, in your colours.
          </p>
          <div className="mt-10">
            <CropLab />
          </div>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 items-center gap-12 lg:grid-cols-[4fr_5fr]">
          <Reveal className="mx-auto w-full max-w-[300px]">
            <div className="aspect-[9/16] overflow-hidden rounded-[40px] border-[6px] border-ink bg-ink shadow-[0_2px_4px_rgba(20,23,26,0.08),0_32px_64px_rgba(20,23,26,0.2)]">
              <AutoVideo src="/showcase/clip-branded.mp4" poster="/showcase/clip-branded.jpg" label="Clip #1, Chicken meat injected with saline, with captions, title, B roll, sound effects and a voiced end card" className="h-full w-full object-cover" sound />
            </div>
            <p className="mt-3 text-center font-mono text-xs text-faint">Finished clip #1 · 36.7 s · with sound</p>
          </Reveal>

          <div>
            <Reveal>
              <h3 className="text-2xl font-semibold tracking-tight">Then it gets finished.</h3>
              <p className="mt-3 max-w-[520px] text-base text-muted text-pretty">
                B roll matched to what is said, sound design under the voice, a branded end card, and a cover in every size the platforms ask for.
              </p>
            </Reveal>
            <CoverFan />
            <p className="mt-10 text-xs text-faint">
              Source: “Natural food | Wikipedia audio article”, CC BY, youtube.com/watch?v=GyjyUeSUe_E. Edited excerpt; captions and branding added. Every
              source is checked for rights and your content rules before anything is cut.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
