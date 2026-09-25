import { AutoVideo } from "./AutoVideo";
import { EngineMotion } from "./EngineMotion";
import { InView } from "./Reveal";
import { PlatformIcon } from "@/components/PlatformIcon";

// One coordinate space for the SVG routes and the HTML media placed on them:
// every box is given in viewBox units and converted to percentages.
const W = 1120;
const H = 620;
const pos = (x: number, y: number, w: number, h: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` });

const ROUTES = {
  input: "M236 310 C290 310 300 310 356 310",
  toPromo: "M506 300 C540 300 530 204 566 204",
  toClip: "M506 320 C600 330 650 392 742 392",
  toCover: "M506 316 C540 330 540 470 580 470",
  promoTikTok: "M712 170 C850 150 880 120 974 120",
  promoYouTube: "M712 220 C850 230 880 222 974 222",
  clipInstagram: "M890 360 C930 350 940 324 974 324",
  clipX: "M890 410 C930 420 940 426 974 426",
  coverLinkedIn: "M716 500 C850 520 900 528 974 528",
} as const;

// Each platform lights up as its packet lands (same period, delayed to arrival).
const PLATFORMS = [
  { id: "tiktok", y: 120, packet: 0 },
  { id: "youtube", y: 222, packet: 1 },
  { id: "instagram", y: 324, packet: 2 },
  { id: "x", y: 426, packet: 3 },
  { id: "linkedin", y: 528, packet: 4 },
];

const STAGES = ["storyboard", "render 9:16", "render 16:9", "transcribe", "rank moments", "captions", "covers", "post copy"];

function Route({ d, draw, pulse = false }: { d: string; draw: number; pulse?: boolean }) {
  return (
    <g>
      <path d={d} pathLength={1} className="engine-rail engine-draw" style={{ ["--d" as string]: `${draw}ms` }} />
      {pulse && <path d={d} pathLength={100} className="engine-pulse engine-pulse-slow" style={{ animationDelay: "1.6s" }} />}
    </g>
  );
}

// Posts in flight: the real covers ride the outer routes to each platform.
const PACKETS = [
  { route: ROUTES.promoTikTok, img: "/showcase/cover-promo-vertical.webp", begin: 2.2, dur: 3.4 },
  { route: ROUTES.promoYouTube, img: "/showcase/cover-promo-vertical.webp", begin: 3.9, dur: 3.2 },
  { route: ROUTES.clipInstagram, img: "/showcase/cover-611e6afe-feed.webp", begin: 2.8, dur: 2.6 },
  { route: ROUTES.clipX, img: "/showcase/cover-ab41d9e5-feed.webp", begin: 4.7, dur: 2.6 },
  { route: ROUTES.coverLinkedIn, img: "/showcase/cover-611e6afe-feed.webp", begin: 3.4, dur: 3.6 },
];

function Packet({ route, img, begin, dur }: (typeof PACKETS)[number]) {
  return (
    <g className="engine-packet" opacity="0">
      <rect x="-15" y="-18" width="30" height="36" rx="5" className="fill-surface" filter="url(#packet-shadow)" />
      <image href={img} x="-13" y="-16" width="26" height="32" preserveAspectRatio="xMidYMid slice" clipPath="url(#packet-clip)" />
      <animateMotion dur={`${dur * 2}s`} begin={`${begin}s`} repeatCount="indefinite" path={route} keyPoints="0;1;1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.2 1;0 0 1 1" />
      <animate attributeName="opacity" dur={`${dur * 2}s`} begin={`${begin}s`} repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.06;0.41;0.5;1" />
    </g>
  );
}

function Phone({ className, style, children }: { className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div className={`engine-in absolute overflow-hidden rounded-[18%/10%] border-[5px] border-ink bg-ink shadow-[0_2px_4px_rgba(20,23,26,0.08),0_24px_48px_rgba(20,23,26,0.18)] ${className ?? ""}`} style={style}>
      {children}
    </div>
  );
}

/** Hero graphic: one product in, rendered outputs out, flowing to real channels. */
export function EngineGraphic() {
  return (
    <InView className="engine relative mx-auto hidden w-full max-w-[1120px] md:block" threshold={0.1}>
      <EngineMotion>
      {/* The stage: a faint technical grid that arrives first and never moves. */}
      <div className="engine-stage pointer-events-none absolute -inset-x-16 -inset-y-10" aria-hidden />
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          {/* Entrance: rails draw in from the product outward, then the scene settles. */}
          <Route d={ROUTES.input} draw={300} pulse />
          <Route d={ROUTES.toPromo} draw={560} />
          <Route d={ROUTES.toClip} draw={620} />
          <Route d={ROUTES.toCover} draw={680} />
          <Route d={ROUTES.promoTikTok} draw={900} />
          <Route d={ROUTES.promoYouTube} draw={960} />
          <Route d={ROUTES.clipInstagram} draw={1020} />
          <Route d={ROUTES.clipX} draw={1080} />
          <Route d={ROUTES.coverLinkedIn} draw={1140} />

          {/* The engine: a core that takes one profile and runs every stage. */}
          <g transform="translate(431 310)">
            <circle r="104" pathLength={1} className="engine-orbit engine-draw" style={{ ["--d" as string]: "700ms" }} />
            <rect x="-75" y="-75" width="150" height="150" rx="28" className="engine-in fill-ink" style={{ ["--d" as string]: "450ms" }} />
          </g>
        </svg>

        {/* Packets fly above the phones, so they get their own layer. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden>
          <defs>
            <clipPath id="packet-clip">
              <rect x="-13" y="-16" width="26" height="32" rx="3.5" />
            </clipPath>
            <filter id="packet-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#14171a" floodOpacity="0.18" />
            </filter>
          </defs>
          {PACKETS.map((p, i) => (
            <Packet key={i} {...p} />
          ))}
        </svg>

        {/* Core label and the stage it is running now. */}
        <div className="engine-in absolute flex flex-col items-center justify-center text-center text-canvas" style={{ ...pos(356, 235, 150, 150), ["--d" as string]: "620ms" }}>
          <span className="font-mono text-xs uppercase tracking-widest text-[#8fd3bb]">running</span>
          <span className="engine-ticker relative mt-2 h-6 w-full overflow-hidden text-sm font-semibold">
            {STAGES.map((s, i) => (
              <span key={s} className="engine-ticker-item absolute inset-x-0" style={{ animationDelay: `${i * 2}s` }}>
                {s}
              </span>
            ))}
          </span>
        </div>

        {/* In: the product, as it was described once. */}
        <div className="engine-in absolute flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-[0_1px_2px_rgba(20,23,26,0.05),0_12px_32px_rgba(20,23,26,0.08)]" style={{ ...pos(0, 170, 236, 280), ["--d" as string]: "200ms" }}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/showcase/labelwise-icon.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">LabelWise</p>
              <p className="truncate text-xs text-muted">Know what is really inside any product you buy</p>
            </div>
          </div>
          <div className="relative flex-1">
            {[1, 2, 3].map((n, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={n}
                src={`/showcase/labelwise-screen-${n}.webp`}
                alt=""
                className="absolute top-0 h-full w-auto rounded-lg border border-hairline object-cover shadow-[0_4px_12px_rgba(20,23,26,0.08)]"
                style={{ left: `${i * 28}%`, transform: `rotate(${(i - 1) * 4}deg)`, zIndex: i }}
              />
            ))}
          </div>
          <p className="font-mono text-xs text-faint">product profile · 6 screens</p>
        </div>

        {/* Out: real renders. */}
        <Phone style={{ ...pos(566, 70, 146, 260), ["--d" as string]: "780ms" }}>
          <AutoVideo src="/showcase/promo-vertical.mp4" poster="/showcase/promo-vertical.jpg" label="LabelWise launch film, vertical cut, rendered by Distribution" className="h-full w-full object-cover" />
        </Phone>
        <Phone style={{ ...pos(742, 250, 148, 263), ["--d" as string]: "880ms" }}>
          <AutoVideo src="/showcase/clip-branded.mp4" poster="/showcase/clip-branded.jpg" label="A branded short clip with captions, rendered by Distribution" className="h-full w-full object-cover" />
        </Phone>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/showcase/cover-611e6afe-feed.webp"
          alt="Clip cover generated by Distribution: Chicken can be 25% saline solution and labeled natural"
          className="engine-in engine-in-tilt absolute rounded-xl border border-hairline object-cover shadow-[0_2px_4px_rgba(20,23,26,0.06),0_16px_32px_rgba(20,23,26,0.14)]"
          style={{ ...pos(580, 400, 136, 170), ["--d" as string]: "960ms" }}
        />

        {/* Where it lands. */}
        {PLATFORMS.map((p) => (
          <div key={p.id} className="engine-in absolute grid place-items-center" style={{ ...pos(974, p.y - 26, 52, 52), ["--d" as string]: `${1180 + p.packet * 70}ms` }}>
            <span className="engine-blip absolute inset-0 rounded-full" style={{ animationDelay: `${PACKETS[p.packet]!.begin + PACKETS[p.packet]!.dur * 0.98}s`, animationDuration: `${PACKETS[p.packet]!.dur * 2}s` }} aria-hidden />
            <span className="relative grid h-full w-full place-items-center rounded-full border border-hairline bg-surface text-ink shadow-[0_1px_2px_rgba(20,23,26,0.06)]">
              <PlatformIcon platform={p.id} size={20} />
            </span>
          </div>
        ))}

        <p className="absolute font-mono text-xs text-faint" style={pos(0, 470, 236, 20)}>in</p>
        <p className="absolute text-center font-mono text-xs text-faint" style={pos(566, 580, 330, 20)}>out: film, clips, covers</p>
        <p className="absolute text-center font-mono text-xs text-faint" style={pos(950, 575, 100, 20)}>posted</p>
      </div>
      </EngineMotion>
    </InView>
  );
}

/** The same story for narrow screens: a vertical flow instead of a spread. */
export function EngineGraphicCompact() {
  return (
    <InView className="engine md:hidden" threshold={0.1}>
      <div className="engine-in mx-auto flex max-w-[420px] flex-col items-center" style={{ ["--d" as string]: "900ms" }}>
        <div className="flex w-full items-center gap-3 rounded-2xl border border-hairline bg-surface p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/showcase/labelwise-icon.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">LabelWise</p>
            <p className="truncate text-xs text-muted">product profile · 6 screens</p>
          </div>
          <span className="font-mono text-xs text-faint">in</span>
        </div>
        <span className="engine-drop h-8 w-px" aria-hidden />
        <div className="grid h-16 w-full place-items-center rounded-2xl bg-ink text-canvas">
          <span className="engine-ticker relative h-6 w-40 overflow-hidden text-center text-sm font-semibold">
            {STAGES.map((s, i) => (
              <span key={s} className="engine-ticker-item absolute inset-x-0" style={{ animationDelay: `${i * 2}s` }}>
                {s}
              </span>
            ))}
          </span>
        </div>
        <span className="engine-drop h-8 w-px" aria-hidden />
        <div className="grid w-full grid-cols-2 gap-3">
          <div className="aspect-[9/16] overflow-hidden rounded-[24px] border-4 border-ink bg-ink">
            <AutoVideo src="/showcase/promo-vertical.mp4" poster="/showcase/promo-vertical.jpg" label="LabelWise launch film, vertical cut" className="h-full w-full object-cover" />
          </div>
          <div className="aspect-[9/16] overflow-hidden rounded-[24px] border-4 border-ink bg-ink">
            <AutoVideo src="/showcase/clip-branded.mp4" poster="/showcase/clip-branded.jpg" label="A branded short clip with captions" className="h-full w-full object-cover" />
          </div>
        </div>
        <span className="engine-drop h-8 w-px" aria-hidden />
        <ul className="flex items-center gap-3">
          {PLATFORMS.map((p) => (
            <li key={p.id} className="relative grid h-11 w-11 place-items-center rounded-full border border-hairline bg-surface">
              <span className="engine-blip absolute inset-0 rounded-full" style={{ animationDelay: `${PACKETS[p.packet]!.begin + PACKETS[p.packet]!.dur * 0.98}s`, animationDuration: `${PACKETS[p.packet]!.dur * 2}s` }} aria-hidden />
              <PlatformIcon platform={p.id} size={18} />
            </li>
          ))}
        </ul>
      </div>
    </InView>
  );
}
