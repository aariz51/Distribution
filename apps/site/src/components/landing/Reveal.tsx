"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Heavy fade-up on first entry. Content is rendered visible on the server and
 * only hidden once this script has run (`data-reveal="pending"`), so a failed
 * or disabled script leaves everything readable.
 */
export function Reveal({ as: Tag = "div", delay = 0, className, children }: { as?: ElementType; delay?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return; // already on screen: never hide it
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          el.style.transitionDelay = `${delay}ms`;
          el.dataset.reveal = "shown";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}

/**
 * Adds `data-inview` while the element is on screen, so CSS can run or pause
 * loops, and `data-seen` once it has been, for sequences that play once.
 */
export function InView({ className, children, threshold = 0.25, id }: { className?: string; children: ReactNode; threshold?: number; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Hidden start states only apply once armed, so without this script (or
    // with reduced motion) every one-shot element is simply visible.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) el.dataset.armed = "true";
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      el.dataset.inview = e.isIntersecting ? "true" : "false";
      // One-shot sequences key off data-seen so they play once and stay settled.
      if (e.isIntersecting) el.dataset.seen = "true";
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return (
    <div ref={ref} id={id} className={className} data-inview="false">
      {children}
    </div>
  );
}
