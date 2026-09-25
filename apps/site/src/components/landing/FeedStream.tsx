"use client";

import { useEffect, useRef } from "react";

// Real covers made on this installation, arranged as three feed columns.
const COLUMNS = [
  ["wall-1", "cover-promo-vertical", "wall-4", "cover-611e6afe-feed", "wall-7", "wall-2"],
  ["cover-ab41d9e5-feed", "wall-3", "wall-6", "cover-611e6afe-portrait", "wall-8", "wall-5"],
  ["wall-5", "cover-611e6afe-feed", "wall-2", "cover-ab41d9e5-portrait", "wall-1", "wall-6"],
];
const SPEED = [0.22, -0.16, 0.3];

/**
 * A feed, beside the line about showing up where people look. Columns drift
 * at different speeds as the page scrolls, like thumbs through a feed.
 */
export function FeedStream() {
  const ref = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const render = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const offset = window.innerHeight / 2 - (r.top + r.height / 2);
      cols.current.forEach((c, i) => c && (c.style.transform = `translate3d(0, ${(offset * SPEED[i]!).toFixed(1)}px, 0)`));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else window.removeEventListener("scroll", onScroll);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className="feed-stream relative grid h-[560px] grid-cols-3 gap-3 overflow-hidden" aria-hidden>
      {COLUMNS.map((col, i) => (
        <div key={i} ref={(el) => { cols.current[i] = el; }} className="flex flex-col gap-3 will-change-transform" style={{ marginTop: `${[-40, -140, -80][i]}px` }}>
          {col.map((c, j) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={j} src={`/showcase/${c}.webp`} alt="" loading="lazy" className="aspect-[4/5] w-full rounded-xl object-cover shadow-[0_1px_2px_rgba(20,23,26,0.06),0_10px_24px_rgba(20,23,26,0.1)]" />
          ))}
        </div>
      ))}
    </div>
  );
}
