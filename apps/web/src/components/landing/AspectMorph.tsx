"use client";

import { useEffect, useRef, useState } from "react";

const CUTS = [
  { key: "vertical", label: "Feeds", w: 1080, h: 1920, fps: 60, src: "promo-vertical" },
  { key: "landscape", label: "YouTube", w: 1920, h: 1080, fps: 60, src: "promo-landscape" },
  { key: "store-portrait", label: "App Store", w: 886, h: 1920, fps: 30, src: "promo-appstore-portrait" },
  { key: "store-landscape", label: "App Store wide", w: 1920, h: 886, fps: 30, src: "promo-appstore-landscape" },
] as const;

const STAGE = 440; // the square the frame fits inside, in px at full size

function fit(w: number, h: number) {
  const r = w / h;
  return r < 1 ? { width: STAGE * r, height: STAGE } : { width: STAGE, height: STAGE / r };
}

/** Counts a number toward its target so the readout moves with the frame. */
function useTween(target: number, ms = 700) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const v = Math.round(a + (target - a) * e);
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

/**
 * One film, four exports. The frame morphs between the real cuts' aspect
 * ratios and the matching real render crossfades in, so the "every size"
 * claim is shown rather than listed.
 */
export function AspectMorph() {
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const visible = useRef(false);
  const cut = CUTS[active]!;
  const box = fit(cut.w, cut.h);
  const w = useTween(cut.w);
  const h = useTween(cut.h);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(([e]) => {
      visible.current = Boolean(e?.isIntersecting);
      const v = videos.current[active];
      if (!v || reduced) return;
      if (visible.current) void v.play().catch(() => undefined);
      else v.pause();
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);

  // Only the showing cut plays; the rest rest at their posters.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && visible.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        v.currentTime = 0;
        void v.play().catch(() => undefined);
      } else v.pause();
    });
  }, [active]);

  // Tour the four sizes once while on screen, then rest on the first until
  // the viewer picks one. A showcase, not a carousel.
  useEffect(() => {
    if (pinned || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let steps = 0;
    const id = window.setInterval(() => {
      if (!visible.current || document.hidden) return;
      steps += 1;
      setActive((a) => (a + 1) % CUTS.length);
      if (steps >= CUTS.length) window.clearInterval(id);
    }, 4200);
    return () => window.clearInterval(id);
  }, [pinned]);

  return (
    <div ref={rootRef} className="aspect-morph">
      <div className="relative mx-auto grid aspect-square w-full max-w-[440px] place-items-center">
        {/* A faint ghost of every size, so the change reads as a change. */}
        {CUTS.map((c, i) => {
          const g = fit(c.w, c.h);
          return <span key={c.key} className={`morph-ghost absolute rounded-xl border border-dashed ${i === active ? "opacity-0" : "opacity-100"}`} style={{ width: `${(g.width / STAGE) * 100}%`, height: `${(g.height / STAGE) * 100}%` }} aria-hidden />;
        })}
        <div className="morph-frame relative overflow-hidden rounded-xl bg-ink shadow-[0_2px_4px_rgba(20,23,26,0.08),0_32px_64px_rgba(20,23,26,0.22)]" style={{ width: `${(box.width / STAGE) * 100}%`, height: `${(box.height / STAGE) * 100}%` }}>
          {CUTS.map((c, i) => (
            <video
              key={c.key}
              ref={(el) => { videos.current[i] = el; }}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${i === active ? "opacity-100" : "opacity-0"}`}
              src={`/showcase/${c.src}.mp4`}
              poster={`/showcase/${c.src}.jpg`}
              muted
              loop
              playsInline
              preload={i === 0 ? "metadata" : "none"}
              aria-hidden={i !== active}
              aria-label={`LabelWise launch film, ${c.label} cut, ${c.w} by ${c.h}`}
            />
          ))}
          {/* Crop marks ride the corners as the frame reshapes. */}
          {["left-2 top-2 border-l-2 border-t-2", "right-2 top-2 border-r-2 border-t-2", "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"].map((c) => (
            <span key={c} className={`absolute h-4 w-4 border-white/80 ${c}`} aria-hidden />
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-sm tabular-nums" aria-live="polite">
          <span className="text-ink">{w}</span>
          <span className="text-faint"> × </span>
          <span className="text-ink">{h}</span>
          <span className="text-faint"> · {cut.fps} fps</span>
        </p>
        <div role="tablist" aria-label="Export size" className="flex gap-1 rounded-full border border-hairline bg-canvas p-1">
          {CUTS.map((c, i) => {
            const g = fit(c.w, c.h);
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => {
                  setActive(i);
                  setPinned(true);
                }}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold landing-ease duration-300 ${i === active ? "bg-ink text-canvas" : "text-muted hover:text-ink"}`}
              >
                <span className="grid h-4 w-4 place-items-center" aria-hidden>
                  <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: `${(g.width / STAGE) * 14}px`, height: `${(g.height / STAGE) * 14}px` }} />
                </span>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
