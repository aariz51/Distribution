"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Clip #1's real words and timings (transcripts table, 400.82 s onward).
const WORDS: Array<[string, number]> = [
  ["can", 400.82], ["include", 401.1], ["ingredients", 401.52], ["that", 402.06], ["may", 402.36], ["not", 402.52], ["be", 402.7],
  ["considered", 402.86], ["natural", 403.3], ["by", 403.76], ["some", 404.0], ["consumers.", 404.2], ["The", 404.7], ["poultry", 405.16],
  ["industry", 406.42], ["has", 406.96], ["been", 407.16], ["criticized", 407.36], ["by", 407.86], ["the", 408.18], ["Center", 408.3],
  ["for", 408.56], ["Science", 408.8], ["in", 409.14], ["the", 409.38], ["public", 409.5], ["interest", 409.82], ["for", 410.26],
  ["labeling", 410.5], ["chicken", 410.8], ["meat", 411.2], ["all", 411.48], ["natural.", 412.04],
];
const T0 = 400.82;
const LOOP = 413.4 - T0;
const TITLE = "Chicken meat injected with saline";

/** Up to three words per caption, breaking after sentence ends, like the renderer. */
function chunk(words: typeof WORDS) {
  const chunks: number[][] = [];
  let cur: number[] = [];
  words.forEach(([w], i) => {
    cur.push(i);
    if (cur.length === 3 || /[.!?]$/.test(w)) {
      chunks.push(cur);
      cur = [];
    }
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function CropLab() {
  const chunks = useMemo(() => chunk(WORDS), []);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let running = false;
    let start = performance.now();
    let last = -1;
    const tick = (now: number) => {
      const t = ((now - start) / 1000) % LOOP;
      let idx = 0;
      for (let i = 0; i < WORDS.length; i++) if (WORDS[i]![1] - T0 <= t) idx = i;
      if (idx !== last) {
        last = idx;
        setActive(idx);
      }
      if (running) frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !running) {
        running = true;
        start = performance.now();
        el.dataset.running = "true";
        frame = requestAnimationFrame(tick);
      } else if (!e?.isIntersecting) {
        running = false;
        el.dataset.running = "false";
        cancelAnimationFrame(frame);
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const chunkIdx = chunks.findIndex((c) => c.includes(active));
  const current = chunks[Math.max(0, chunkIdx)]!;

  return (
    <div ref={rootRef} className="crop-lab grid grid-cols-1 items-center gap-8 md:grid-cols-[1.1fr_auto_0.8fr]" data-running="false">
      <figure>
        <div className="relative overflow-hidden rounded-2xl" style={{ aspectRatio: "584 / 720" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/showcase/source-frame-1.webp" alt="A frame from the source video: a table of fruit and vegetables" className="absolute inset-0 h-full w-full object-cover" />
          <div className="crop-window absolute inset-y-0 rounded-md">
            {["-left-px -top-px border-l-[3px] border-t-[3px]", "-right-px -top-px border-r-[3px] border-t-[3px]", "-bottom-px -left-px border-b-[3px] border-l-[3px]", "-bottom-px -right-px border-b-[3px] border-r-[3px]"].map((c) => (
              <span key={c} className={`absolute h-6 w-6 border-[#8fd3bb] ${c}`} aria-hidden />
            ))}
            <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#8fd3bb] px-2 py-0.5 font-mono text-xs text-ink">9:16</span>
          </div>
        </div>
        <figcaption className="mt-3 flex justify-between font-mono text-xs text-faint">
          <span>source · 584 × 720</span>
          <span>the crop follows the subject</span>
        </figcaption>
      </figure>

      <svg viewBox="0 0 80 24" className="mx-auto hidden w-20 md:block" aria-hidden>
        <path d="M2 12 H70" className="crop-arrow stroke-faint" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M62 5 L72 12 L62 19" className="stroke-faint" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <figure className="mx-auto w-full max-w-[300px]">
        <div className="crop-result relative overflow-hidden rounded-[32px] border-[6px] border-ink bg-ink shadow-[0_2px_4px_rgba(20,23,26,0.08),0_32px_64px_rgba(20,23,26,0.2)]" style={{ aspectRatio: "9 / 16", backgroundImage: "url(/showcase/source-frame-1.webp)" }}>
          <p className="caption-title absolute inset-x-3 top-6 text-center text-base font-bold uppercase leading-tight text-white">{TITLE}</p>
          <p className="absolute inset-x-3 bottom-[22%] flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-center text-2xl font-bold uppercase leading-tight" aria-live="off">
            {current.map((i) => (
              <span key={i} className={`caption-word rounded-md px-1 ${i === active ? "caption-word-active" : ""}`}>
                {WORDS[i]![0].replace(/[.]$/, "")}
              </span>
            ))}
          </p>
        </div>
        <figcaption className="mt-3 text-center font-mono text-xs text-faint">clip #1 text track · real word timings</figcaption>
      </figure>
    </div>
  );
}
