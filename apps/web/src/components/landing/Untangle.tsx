"use client";

import { useEffect, useRef } from "react";

const CHORES = [
  "Script and cut a launch film",
  "Export feed and App Store sizes",
  "Find moments in long videos",
  "Crop, caption and title clips",
  "Design a cover for each post",
  "Write copy for each platform",
  "Post on schedule, every week",
];

type Pt = [number, number];

// The knot: hand placed so the line doubles back on itself the way the work does.
const KNOTS: Pt[] = [
  [40, 300], [150, 190], [230, 380], [110, 400], [90, 250], [250, 170], [380, 120], [330, 360],
  [240, 290], [430, 400], [520, 170], [470, 130], [610, 250], [560, 410], [700, 360], [650, 180],
  [770, 140], [830, 380], [720, 420], [880, 260], [960, 300],
];

function catmullRom(points: Pt[], steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Resample a polyline to n points evenly spaced by arc length. */
function resample(poly: Pt[], n: number): Pt[] {
  const lens = [0];
  for (let i = 1; i < poly.length; i++) lens.push(lens[i - 1]! + Math.hypot(poly[i]![0] - poly[i - 1]![0], poly[i]![1] - poly[i - 1]![1]));
  const total = lens[lens.length - 1]!;
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < lens.length - 2 && lens[j + 1]! < target) j++;
    const seg = lens[j + 1]! - lens[j]! || 1;
    const f = (target - lens[j]!) / seg;
    out.push([poly[j]![0] + (poly[j + 1]![0] - poly[j]![0]) * f, poly[j]![1] + (poly[j + 1]![1] - poly[j]![1]) * f]);
  }
  return out;
}

const N = 220;
const TANGLED = resample(catmullRom(KNOTS, 14), N);
const STRAIGHT: Pt[] = Array.from({ length: N }, (_, i) => [40 + (920 * i) / (N - 1), 300]);
const NODE_AT = CHORES.map((_, i) => Math.round(((i + 1) / (CHORES.length + 1)) * (N - 1)));

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function geometry(t: number) {
  // Straightens as a wave from left to right, so the eye follows the fix.
  const pts = TANGLED.map((p, i) => {
    const local = ease(clamp(t * 1.5 - (i / N) * 0.5));
    return [p[0] + (STRAIGHT[i]![0] - p[0]) * local, p[1] + (STRAIGHT[i]![1] - p[1]) * local] as Pt;
  });
  return { d: "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L"), pts };
}

const FINAL = geometry(1);

export function Untangle() {
  const trackRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const nodeRefs = useRef<(SVGGElement | null)[]>([]);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    track.dataset.armed = "true";
    let frame = 0;
    const render = () => {
      frame = 0;
      const r = track.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = clamp(-r.top / (span || 1));
      const t = clamp((p - 0.08) / 0.72);
      const { d, pts } = geometry(t);
      pathRef.current?.setAttribute("d", d);
      NODE_AT.forEach((idx, i) => {
        const node = nodeRefs.current[i];
        const [x, y] = pts[idx]!;
        const done = t > 0.72 + i * 0.035;
        if (node) {
          node.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          node.dataset.done = String(done);
        }
        const item = itemRefs.current[i];
        if (item) item.dataset.done = String(done);
      });
      track.dataset.solved = String(t > 0.98);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    // Only listen while the scene is anywhere near the viewport.
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else window.removeEventListener("scroll", onScroll);
    }, { rootMargin: "20% 0px" });
    io.observe(track);
    render();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    // An inset dark sheet: the page's first dark moment, echoed by the closing panel.
    <section aria-labelledby="gap-title" className="px-2 sm:px-3">
      <div ref={trackRef} className="untangle-track relative rounded-[32px] bg-ink text-canvas" data-solved="true">
        <div className="untangle-stage flex flex-col justify-center px-4 py-24 sm:px-6">
          <div className="mx-auto w-full max-w-[1120px]">
            <h2 id="gap-title" className="max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Building got fast. Being seen didn&apos;t.
            </h2>
            <p className="mt-4 max-w-[560px] text-lg text-[#b9bfb9] text-pretty">
              Shipping is now a straight line. The work after launch is still a knot of editing, cutting, designing and posting, and it comes back every week.
            </p>

            <div className="relative mt-10">
              <svg viewBox="0 0 1000 460" className="w-full overflow-visible" aria-hidden>
                {/* Already easy: a short, clean line. */}
                <g>
                  <text x="40" y="46" className="hidden fill-[#9aa19a] font-mono sm:block text-[15px] uppercase tracking-widest">already easy</text>
                  <line x1="40" y1="78" x2="400" y2="78" className="stroke-[#8fd3bb]" strokeWidth="3" strokeLinecap="round" />
                  {["Idea", "Built with AI", "Live"].map((l, i) => (
                    <g key={l} transform={`translate(${40 + i * 180} 78)`}>
                      <circle r="9" className="fill-[#8fd3bb]" />
                      <path d="M-4 0 l3 3 l5 -6" className="stroke-ink" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      <text y="36" textAnchor={i === 0 ? "start" : "middle"} x={i === 0 ? -9 : 0} className="hidden fill-canvas text-[16px] font-semibold sm:block">{l}</text>
                    </g>
                  ))}
                  <text x="40" y="178" className="hidden fill-[#9aa19a] font-mono sm:block text-[15px] uppercase tracking-widest">after launch</text>
                </g>

                <path ref={pathRef} d={FINAL.d} className="untangle-line fill-none stroke-canvas" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d={FINAL.d} pathLength={100} className="untangle-pulse fill-none" strokeWidth="4" strokeLinecap="round" />

                {CHORES.map((c, i) => {
                  const [x, y] = FINAL.pts[NODE_AT[i]!]!;
                  const above = i % 2 === 0;
                  return (
                    <g key={c} ref={(el) => { nodeRefs.current[i] = el; }} transform={`translate(${x} ${y})`} data-done="true" className="untangle-node">
                      <circle r="11" className="untangle-dot" />
                      <path d="M-4.5 0 l3.2 3.2 l5.8 -6.6" className="untangle-check" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      <text y={above ? -24 : 38} textAnchor="middle" className="untangle-label hidden text-[15px] sm:block">{c}</text>
                    </g>
                  );
                })}
              </svg>

              <p className="untangle-solved mt-6 font-mono text-sm text-[#8fd3bb]">Distribution runs all of it. You approve what goes out.</p>
            </div>

            {/* The same list for small screens and screen readers. */}
            <ol className="mt-8 space-y-2 sm:sr-only">
              {CHORES.map((c, i) => (
                <li key={c} ref={(el) => { itemRefs.current[i] = el; }} data-done="true" className="untangle-item flex items-center gap-3 text-base">
                  <span className="untangle-item-dot grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/25 text-xs text-ink" aria-hidden>✓</span>
                  {c}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
