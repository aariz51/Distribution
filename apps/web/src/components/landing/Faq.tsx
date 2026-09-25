import { Plus } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "./Reveal";

export const FAQ = [
  {
    q: "What do I need to start?",
    a: "An email address and your product: its name, what it does and a logo. Screenshots are optional; add them if you want your screens in the films. Colours are sampled from your assets if you do not have a palette.",
  },
  {
    q: "Which platforms can it post to?",
    a: "TikTok, YouTube, Instagram, Facebook, X, LinkedIn, Threads and Pinterest. You connect each one through Postiz with the platform's own sign in.",
  },
  {
    q: "Does anything post without me?",
    a: "No. Every film, clip and cover arrives in review. Only what you approve can be scheduled, and you choose when.",
  },
  {
    q: "Can I clip any YouTube video?",
    a: "Only videos you own or have permission to use. You confirm the rights when you add a source, and each source is checked against your content rules before anything is cut.",
  },
  {
    q: "How long does a promo film take?",
    a: "Usually a few minutes from pressing generate to four finished cuts. Clips from a long video take longer, since every word is transcribed first.",
  },
  {
    q: "Do you store my social media passwords?",
    a: "No. You sign in on each platform's own page. We keep an encrypted Postiz key for your workspace so approved posts can be sent.",
  },
  {
    q: "Is my work visible to anyone else?",
    a: "No. Each workspace is separate: its products, media, channels and usage limit belong to it alone.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 border-t border-hairline px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-12 lg:grid-cols-[2fr_3fr]">
        <Reveal>
          <h2 id="faq-title" className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Common questions
          </h2>
        </Reveal>
        <Reveal>
          <div className="faq-list divide-y divide-hairline border-y border-hairline">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Plus size={18} className="shrink-0 text-muted landing-ease duration-500 group-open:rotate-45" aria-hidden />
                </summary>
                <p className="mt-3 max-w-[60ch] text-base text-muted text-pretty">{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
