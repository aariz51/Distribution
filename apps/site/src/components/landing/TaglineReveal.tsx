"use client";

import { useEffect, useRef } from "react";

/**
 * The page's one large statement. Each word starts muted and turns to full ink
 * as it crosses a line 60% down the viewport, in reading order. Words that
 * cross together are staggered so the sweep still reads left to right. The
 * sentence is exposed unsplit to assistive technology.
 */
export function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const words = Array.from(root.querySelectorAll<HTMLElement>("[data-word]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      words.forEach((w) => (w.dataset.lit = "true"));
      return;
    }
    root.dataset.armed = "true";
    const io = new IntersectionObserver(
      (entries) => {
        const hits = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        hits.sort((a, b) => Number(a.dataset.word) - Number(b.dataset.word));
        hits.forEach((w, i) => {
          w.style.transitionDelay = `${i * 70}ms`;
          w.dataset.lit = "true";
          io.unobserve(w);
        });
      },
      { rootMargin: "0px 0px -40% 0px" },
    );
    words.forEach((w) => io.observe(w));
    return () => io.disconnect();
  }, []);

  let n = 0;
  return (
    <p ref={ref} className="tagline-reveal max-w-[20ch] text-4xl font-semibold tracking-tight text-balance sm:text-6xl" aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span key={li} className="block" aria-hidden>
          {line.split(" ").map((word, wi) => (
            <span key={wi} data-word={n++} className="tagline-word">
              {word}{" "}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}
