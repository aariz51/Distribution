import Link from "next/link";
import { ArrowDown } from "@phosphor-icons/react/dist/ssr";
import { EngineGraphic, EngineGraphicCompact } from "./EngineGraphic";
import { APP_LINKS } from "@/lib/app-links";

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="relative px-4 pt-28 sm:px-6 sm:pt-32">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-end gap-8 lg:grid-cols-[7fr_5fr] lg:gap-12">
        <div>
          <p className="hero-seq mb-6 font-mono text-xs uppercase tracking-widest text-muted" style={{ ["--d" as string]: "200ms" }}>
            Launch films <span className="text-hairline-strong">/</span> clips <span className="text-hairline-strong">/</span> publishing
          </p>
          <h1 id="hero-title" className="max-w-[680px] text-5xl font-semibold tracking-tight sm:text-7xl">
            <span className="hero-line hero-heading block text-balance" style={{ ["--d" as string]: "400ms" }}>
              Anyone can build an app now.
            </span>
            <span className="hero-line hero-heading block" style={{ ["--d" as string]: "540ms" }}>
              We get it seen.
            </span>
          </h1>
        </div>
        <div className="max-w-[680px] lg:pb-2">
          <p className="hero-seq text-lg text-muted text-pretty" style={{ ["--d" as string]: "650ms" }}>
            Distribution turns your product into a launch film, captioned clips with covers, and posts scheduled to TikTok, YouTube and Instagram.
            You describe it once and approve what goes out.
          </p>
          <div className="hero-seq mt-6 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "850ms" }}>
            <Link href={signedIn ? APP_LINKS.workspace : APP_LINKS.signup} className="landing-cta">
              {signedIn ? "Open your workspace" : APP_LINKS.signupLabel}
            </Link>
            <a href="#promo" className="group inline-flex items-center gap-2 rounded-full px-4 py-3 text-base font-semibold text-ink landing-ease duration-300 hover:bg-surface">
              See what it makes <ArrowDown size={16} aria-hidden className="landing-ease duration-500 group-hover:translate-y-0.5" />
            </a>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-[1120px]">
        <EngineGraphic />
        <EngineGraphicCompact />
        <p className="hero-seq mt-6 text-center text-sm text-faint" style={{ ["--d" as string]: "1500ms" }}>
          Every film, clip and cover on this page was made by Distribution for LabelWise, a real food label scanning app.
        </p>
      </div>
    </section>
  );
}
