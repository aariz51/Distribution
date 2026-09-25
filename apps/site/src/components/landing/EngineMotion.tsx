"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Owns the hero engine's live behaviour: SMIL packets are paused off screen
 * and under reduced motion (CSS cannot pause SMIL), and the pointer drives a
 * soft light across the routes.
 */
export function EngineMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const svgs = () => Array.from(el.querySelectorAll("svg")) as SVGSVGElement[];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svgs().forEach((s) => s.pauseAnimations?.());
      el.dataset.still = "true";
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      svgs().forEach((s) => (e?.isIntersecting ? s.unpauseAnimations?.() : s.pauseAnimations?.()));
    }, { threshold: 0.05 });
    io.observe(el);
    let frame = 0;
    const move = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${((ev.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty("--my", `${((ev.clientY - r.top) / r.height) * 100}%`);
        el.dataset.lit = "true";
      });
    };
    const leave = () => (el.dataset.lit = "false");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div ref={ref} className="engine-motion relative">
      <div className="engine-light pointer-events-none absolute inset-0" aria-hidden />
      {children}
    </div>
  );
}
