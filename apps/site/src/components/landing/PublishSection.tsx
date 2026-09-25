import { Check, Clock } from "@phosphor-icons/react/dist/ssr";
import { PlatformIcon } from "@/components/PlatformIcon";
import { InView, Reveal } from "./Reveal";

const ORBIT = ["tiktok", "youtube", "instagram", "facebook", "x", "linkedin", "threads", "pinterest"];

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = [
  { day: 0, time: "09:00", platform: "tiktok", thumb: "/showcase/cover-611e6afe-portrait.webp", what: "Clip #1", state: "Published" },
  { day: 1, time: "12:30", platform: "youtube", thumb: "/showcase/cover-promo-vertical.webp", what: "Launch film", state: "Published" },
  { day: 3, time: "09:15", platform: "linkedin", thumb: "/showcase/cover-promo-landscape.webp", what: "Launch film", state: "Scheduled" },
  { day: 4, time: "17:45", platform: "tiktok", thumb: "/showcase/cover-ab41d9e5-portrait.webp", what: "Clip #2", state: "Scheduled" },
  { day: 5, time: "11:00", platform: "x", thumb: "/showcase/cover-611e6afe-feed.webp", what: "Clip #1", state: "Scheduled" },
];

const POINTS = [
  { title: "Sign in on the platform's own page", body: "Connect TikTok, YouTube, Instagram and more through Postiz. We never see or store your social passwords." },
  { title: "Nothing posts without your yes", body: "Everything lands in review first. Approve what is good, reject what is not." },
  { title: "Copy written for each platform", body: "Hook, caption, hashtags and call to action, kept inside each platform's limits." },
  { title: "Status for every post", body: "Each post reports back per channel. A retry never posts the same thing twice." },
];

function Orbit() {
  const r = 42; // percent of the box
  return (
    // The ring rotates, so its box swells at 45°; clip it, with room for shadows.
    <InView className="relative mx-auto aspect-square w-full max-w-[400px] overflow-clip [overflow-clip-margin:16px]" threshold={0.2}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {ORBIT.map((p, i) => {
          const a = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={p}
              x1={50 + Math.cos(a) * 17}
              y1={50 + Math.sin(a) * 17}
              x2={50 + Math.cos(a) * 36}
              y2={50 + Math.sin(a) * 36}
              pathLength={1}
              className="orbit-spoke stroke-accent"
              strokeWidth="0.35"
              strokeLinecap="round"
              style={{ ["--d" as string]: `${200 + i * 70}ms` }}
            />
          );
        })}
      </svg>
      <span className="absolute inset-[8%] rounded-full border border-dashed border-hairline-strong" aria-hidden />
      <div className="orbit-ring absolute inset-0">
        {ORBIT.map((p, i) => {
          const a = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <span
              key={p}
              className="absolute grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
            >
              <span className="orbit-upright grid h-12 w-12 place-items-center rounded-full border border-hairline bg-surface text-ink shadow-[0_1px_2px_rgba(20,23,26,0.06),0_8px_20px_rgba(20,23,26,0.08)]">
                <PlatformIcon platform={p} size={20} />
              </span>
            </span>
          );
        })}
      </div>
      <div className="absolute inset-[34%] grid place-items-center rounded-full bg-ink text-canvas shadow-[0_16px_40px_rgba(20,23,26,0.25)]">
        <span className="flex flex-col items-center">
          <Check size={28} weight="bold" className="text-[#8fd3bb]" aria-hidden />
          <span className="mt-1 text-sm font-semibold">Approved</span>
        </span>
      </div>
    </InView>
  );
}

function Week() {
  return (
    <InView className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5" threshold={0.3}>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">This week</p>
        <p className="font-mono text-xs text-faint">sample schedule</p>
      </div>
      <p className="mt-1 flex items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="grid h-3 w-3 place-items-center rounded-full bg-accent text-white"><Check size={8} weight="bold" aria-hidden /></span>published</span>
        <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />scheduled</span>
      </p>
      <div className="drag-stage relative mt-4">
        {/* Ready to schedule: the tray the drag story starts from. */}
        <div className="flex h-16 items-center gap-3 rounded-lg border border-dashed border-hairline-strong px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/showcase/cover-ab41d9e5-feed.webp" alt="" className="drag-source h-12 w-10 rounded object-cover" />
          <span className="text-xs text-muted">
            <span className="block font-semibold text-ink">Clip #2 · approved</span>
            ready to schedule
          </span>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1.5">
        {WEEK.map((d, di) => (
          <div key={d} className="min-w-0">
            <p className="text-center font-mono text-xs text-faint">{d}</p>
            <div className="mt-2 flex min-h-40 flex-col gap-1.5 rounded-lg bg-canvas p-1">
              {SLOTS.filter((s) => s.day === di).map((s) => (
                <div key={s.time} className="slot relative overflow-hidden rounded-md border border-hairline bg-surface" style={{ ["--at" as string]: `${200 + di * 180}ms` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumb} alt="" className="aspect-[4/5] w-full object-cover" />
                  <span
                    className={`absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full ${s.state === "Published" ? "bg-accent text-white" : "bg-surface text-muted"}`}
                    title={`${s.what} · ${s.state}`}
                  >
                    {s.state === "Published" ? <Check size={10} weight="bold" aria-label="Published" /> : <Clock size={10} aria-label="Scheduled" />}
                  </span>
                  <span className="flex items-center justify-center gap-1 px-1 py-1.5 text-ink">
                    <PlatformIcon platform={s.platform} size={11} />
                    <span className="font-mono text-xs max-lg:hidden">{s.time}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
        {/* The drag: a card and a pointer travel from the tray to Wednesday. */}
        <div className="drag-card pointer-events-none absolute overflow-hidden rounded-md border border-hairline bg-surface" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/showcase/cover-ab41d9e5-feed.webp" alt="" className="aspect-[4/5] w-full object-cover" />
          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-surface text-muted">
            <Clock size={10} aria-hidden />
          </span>
          <span className="flex items-center justify-center gap-1 py-1.5 text-ink">
            <PlatformIcon platform="instagram" size={11} />
            <span className="font-mono text-xs max-lg:hidden">18:00</span>
          </span>
        </div>
        <svg viewBox="0 0 24 24" className="drag-pointer pointer-events-none absolute h-6 w-6" aria-hidden>
          <path d="M4 3 L4 19 L8.5 14.5 L11.5 21 L14 20 L11 13.5 L17.5 13.5 Z" className="fill-ink stroke-surface" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="sr-only">Sample: approved clip #2 is dragged onto Wednesday at 18:00 for Instagram.</p>
    </InView>
  );
}

export function PublishSection() {
  return (
    <section id="publish" aria-labelledby="publish-title" className="scroll-mt-24 border-t border-hairline bg-surface px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-[1120px]">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Publishing</p>
          <h2 id="publish-title" className="mt-4 max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Posted where people already scroll.
          </h2>
          <p className="mt-4 max-w-[600px] text-lg text-muted text-pretty">
            Connect your accounts once. Approved films and clips go out on the schedule you set, with copy written for each platform.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <Orbit />
          </Reveal>
          <Reveal delay={120}>
            <Week />
          </Reveal>
        </div>

        <ol className="mt-20 grid gap-x-10 gap-y-8 border-t border-hairline pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map(({ title, body }, i) => (
            <Reveal as="li" key={title} delay={i * 60}>
              <span className="font-mono text-sm text-accent">0{i + 1}</span>
              <h3 className="mt-2 text-base font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted text-pretty">{body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
