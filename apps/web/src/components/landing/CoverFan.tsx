import { Reveal } from "./Reveal";

const COVERS = [
  // Widths fit side by side when spread (22 + 27.5 + 44 plus gaps); rest overlaps them near the middle.
  { src: "/showcase/cover-611e6afe-portrait.webp", label: "Story", ratio: "9:16", w: 22, rest: 18, spread: 0, rot: -7, alt: "Story cover, 9 by 16" },
  { src: "/showcase/cover-611e6afe-feed.webp", label: "Feed", ratio: "4:5", w: 27.5, rest: 32, spread: 25, rot: 0, alt: "Feed cover, 4 by 5: Chicken can be 25% saline solution and labeled natural" },
  { src: "/showcase/cover-611e6afe-landscape.webp", label: "YouTube", ratio: "16:9", w: 44, rest: 44, spread: 55.5, rot: 6, alt: "YouTube cover, 16 by 9" },
];

/** The clip's three real covers, held like a hand of cards; they spread on hover or focus. */
export function CoverFan() {
  return (
    <Reveal className="mt-10">
      <p className="text-sm font-semibold">Covers for clip #1</p>
      <ul className="cover-fan relative mt-4 flex h-64 items-end justify-center sm:h-72" aria-label="Covers in three sizes">
        {COVERS.map((c, i) => (
          <li
            key={c.label}
            className="fan-card absolute bottom-0"
            style={{ ["--rest" as string]: `${c.rest}%`, ["--spread" as string]: `${c.spread}%`, ["--rot" as string]: `${c.rot}deg`, width: `${c.w}%`, zIndex: i === 1 ? 3 : 2 - i }}
          >
            <button type="button" className="group block w-full rounded-xl text-left" aria-label={`${c.label} cover, ${c.ratio}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.src} alt={c.alt} className="w-full rounded-xl border border-hairline shadow-[0_2px_4px_rgba(20,23,26,0.06),0_18px_36px_rgba(20,23,26,0.18)]" />
              <span className="fan-tag mt-2 flex justify-between font-mono text-xs text-faint">
                <span>{c.label}</span>
                <span>{c.ratio}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
