import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { InView, Reveal } from "./Reveal";
import { StepTrack } from "./StepTrack";

// LabelWise's real inferred palette (products.brand.palette).
const PALETTE = ["#091710", "#3d986a", "#f9f6e9", "#122037", "#bb905f"];

const JOBS = [
  { label: "Render vertical film", at: 0 },
  { label: "Render App Store cuts", at: 300 },
  { label: "Rank moments in source", at: 600 },
  { label: "Cut clip #1 with captions", at: 900 },
];

// A station on the rail: a small piece of the product, then plain words. No box.
function StepCard({ n, title, body, children }: { n: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <li data-step={n} data-on="true" className="step-card flex flex-col">
      <div className="step-ui rounded-2xl bg-surface p-5 ring-1 ring-hairline">{children}</div>
      <div className="mt-6 px-1">
        <span className="font-mono text-xs text-accent">{n}</span>
        <h3 className="mt-2 text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm text-muted text-pretty">{body}</p>
      </div>
    </li>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <h2 id="how-title" className="max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Three steps from product to posted.
          </h2>
        </Reveal>
        <StepTrack>
          <ol className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-8">
            <StepCard n="01" title="Describe it once" body="Name, what it does, features in priority order, your audience and a logo, plus screenshots if you want them. Every film and clip reads from this.">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/showcase/labelwise-icon.webp" alt="" width={36} height={36} className="h-9 w-9 rounded-lg" />
                <div>
                  <p className="text-sm font-semibold">LabelWise</p>
                  <p className="text-xs text-muted">Know what is really inside any product you buy</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {["Scan any product label", "Know what is really inside", "Ask your AI ingredient expert"].map((f) => (
                  <span key={f} className="rounded-full border border-hairline bg-canvas px-2 py-0.5 text-xs">
                    {f}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex gap-1.5" aria-label="Brand palette sampled from the logo and screens">
                {PALETTE.map((c) => (
                  <span key={c} className="h-6 flex-1 rounded-md border border-hairline" style={{ background: c }} />
                ))}
              </div>
            </StepCard>

            <StepCard n="02" title="Let it make things" body="Films render and clips cut in the background. You can watch every job, and anything that fails says why and can be retried.">
              <InView className="space-y-3" threshold={0.4}>
                {JOBS.map((j) => (
                  <div key={j.label}>
                    <div className="flex justify-between text-xs">
                      <span>{j.label}</span>
                      <span className="font-mono text-faint">done</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                      <div className="bar-grow h-full rounded-full bg-accent" style={{ ["--at" as string]: `${j.at}ms` }} />
                    </div>
                  </div>
                ))}
              </InView>
            </StepCard>

            <StepCard n="03" title="Approve, then it posts" body="Review everything in one library. Approve the good ones and they go out on your schedule; reject the rest.">
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/showcase/cover-611e6afe-feed.webp" alt="" className="w-20 rounded-lg border border-hairline" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-sm font-semibold">Chicken meat injected with saline</p>
                  <p className="text-xs text-muted">Clip · 36.7 s · 3 covers</p>
                  <div className="mt-auto flex gap-2 pt-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-canvas">
                      <Check size={12} weight="bold" aria-hidden /> Approve
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-3 py-1 text-xs font-semibold">
                      <X size={12} weight="bold" aria-hidden /> Reject
                    </span>
                  </div>
                </div>
              </div>
            </StepCard>
          </ol>
        </StepTrack>
      </div>
    </section>
  );
}
