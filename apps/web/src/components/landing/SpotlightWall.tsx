"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { APP_LINKS } from "@/lib/app-links";

// Real covers from the two LabelWise runs on this installation.
const WALL = [
  "wall-1", "cover-611e6afe-feed", "wall-2", "wall-3", "cover-ab41d9e5-feed", "wall-4",
  "wall-5", "wall-6", "cover-611e6afe-feed", "wall-7", "wall-8", "cover-ab41d9e5-feed",
  "wall-3", "wall-1", "wall-6", "cover-611e6afe-feed", "wall-2", "wall-5",
];

/**
 * The closing panel hides a wall of covers Distribution made; the pointer is a
 * lamp that reveals it. Touch screens get a slow drifting lamp instead. The
 * call to action leans toward the pointer, a few pixels at most.
 */
export function SpotlightWall({ signedIn }: { signedIn: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let pointer = false;
    let t0 = performance.now();
    let visible = false;
    const set = (x: number, y: number) => {
      el.style.setProperty("--sx", `${x}px`);
      el.style.setProperty("--sy", `${y}px`);
    };
    const drift = (now: number) => {
      if (!visible || pointer) return;
      const r = el.getBoundingClientRect();
      const t = (now - t0) / 1000;
      set(r.width * (0.5 + 0.34 * Math.sin(t * 0.42)), r.height * (0.5 + 0.3 * Math.sin(t * 0.61 + 1)));
      frame = requestAnimationFrame(drift);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
      if (visible && !reduced && !pointer) {
        t0 = performance.now();
        frame = requestAnimationFrame(drift);
      } else cancelAnimationFrame(frame);
    });
    io.observe(el);
    const move = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      pointer = true;
      cancelAnimationFrame(frame);
      const r = el.getBoundingClientRect();
      set(ev.clientX - r.left, ev.clientY - r.top);
      const b = cta.current?.getBoundingClientRect();
      if (b && cta.current && !reduced) {
        const dx = ev.clientX - (b.left + b.width / 2);
        const dy = ev.clientY - (b.top + b.height / 2);
        const d = Math.hypot(dx, dy);
        const pull = d < 180 ? (1 - d / 180) * 10 : 0;
        cta.current.style.transform = pull ? `translate(${(dx / d) * pull}px, ${(dy / d) * pull}px)` : "";
      }
    };
    const leave = () => {
      pointer = false;
      if (cta.current) cta.current.style.transform = "";
      if (visible && !reduced) frame = requestAnimationFrame(drift);
    };
    if (reduced) {
      const r = el.getBoundingClientRect();
      set(r.width / 2, r.height / 2);
    }
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
    <div ref={ref} className="spotlight relative overflow-hidden rounded-3xl bg-ink px-6 py-24 text-center text-canvas sm:px-12 sm:py-32">
      <div className="spotlight-wall pointer-events-none absolute -inset-6 grid grid-cols-4 gap-3 sm:grid-cols-6" aria-hidden>
        {WALL.map((w, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={`/showcase/${w}.webp`} alt="" loading="lazy" className="aspect-[4/5] w-full rounded-lg object-cover" style={{ transform: `translateY(${(i % 6) % 2 ? 28 : 0}px)` }} />
        ))}
      </div>
      <div className="spotlight-scrim pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        <h2 id="final-title" className="mx-auto max-w-[680px] text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Your product is built. Let&apos;s get it seen.
        </h2>
        <p className="mx-auto mt-6 max-w-[480px] text-lg text-[#b9bfb9] text-pretty">No card needed. Nothing posts without your approval.</p>
        <Link
          ref={cta}
          href={signedIn ? APP_LINKS.workspace : APP_LINKS.signup}
          className="spotlight-cta mt-10 inline-flex items-center justify-center rounded-full bg-canvas px-6 py-3 text-base font-semibold text-ink"
        >
          {signedIn ? "Open your workspace" : APP_LINKS.signupLabel}
        </Link>
      </div>
    </div>
  );
}
