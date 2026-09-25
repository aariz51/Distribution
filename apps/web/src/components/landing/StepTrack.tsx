"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A line the product travels along as the section is read. The token's
 * position is the reader's progress through the section; each step card
 * switches on as the token reaches its station.
 */
export function StepTrack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.armed = "true";
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-step]"));
    let frame = 0;
    const render = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the track's top reaches 75% of the viewport, 1 when its bottom reaches 55%.
      const p = Math.min(1, Math.max(0, (vh * 0.75 - r.top) / (r.height + vh * 0.2)));
      el.style.setProperty("--p", p.toFixed(4));
      cards.forEach((c, i) => (c.dataset.on = String(p >= (i + 0.5) / cards.length - 0.12)));
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
    render();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className="step-track relative mt-14" style={{ ["--p" as string]: 1 }}>
      {/* The rail and the travelling product, horizontal on wide screens. */}
      <div className="relative mb-8 hidden h-12 lg:block" aria-hidden>
        <span className="absolute inset-x-[16.6%] top-1/2 h-px -translate-y-1/2 bg-hairline-strong" />
        <span className="step-fill absolute left-[16.6%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="step-station absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-canvas" style={{ left: `${16.6 + i * 33.4}%` }} />
        ))}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/showcase/labelwise-icon.webp" alt="" className="step-token absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-surface shadow-[0_8px_20px_rgba(20,23,26,0.2)]" />
      </div>
      {children}
    </div>
  );
}
