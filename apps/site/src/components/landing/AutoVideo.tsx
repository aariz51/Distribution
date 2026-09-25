"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";

/**
 * A real rendered output that plays only while visible. Muted autoplay is the
 * only kind browsers allow; the sound toggle is there for the clip, whose
 * voiced end card is part of what it demonstrates. Under reduced motion it
 * stays on its poster until the viewer presses play.
 */
export function AutoVideo({ src, poster, label, className, sound = false }: { src: string; poster: string; label: string; className?: string; sound?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(prefersReduced);
    if (prefersReduced) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(video);
    const onHidden = () => document.hidden && video.pause();
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        className={className}
        src={src}
        poster={poster}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        controls={reduced}
        aria-label={label}
      />
      {sound && !reduced && (
        <button
          type="button"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            v.muted = !v.muted;
            setMuted(v.muted);
            if (!v.muted) void v.play().catch(() => undefined);
          }}
          className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm motion-safe:transition-transform motion-safe:duration-200 hover:scale-105 active:scale-95"
          aria-label={muted ? "Play with sound" : "Mute"}
          aria-pressed={!muted}
        >
          {muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}
        </button>
      )}
    </div>
  );
}
