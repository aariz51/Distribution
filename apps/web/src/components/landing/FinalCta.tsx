import Link from "next/link";
import { Wordmark } from "@/components/AppShell";
import { InView, Reveal } from "./Reveal";
import { SpotlightWall } from "./SpotlightWall";
import { APP_LINKS } from "@/lib/app-links";

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="final-title" className="px-4 pb-16 sm:px-6">
      <Reveal className="mx-auto max-w-[1120px]">
        <SpotlightWall signedIn={signedIn} />
      </Reveal>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-hairline px-4 pt-10 sm:px-6">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-6 text-sm text-muted">
        <Wordmark className="text-ink" />
        <nav aria-label="Footer" className="flex flex-wrap gap-6">
          <Link href={APP_LINKS.signup} className="hover:text-ink">{APP_LINKS.signupShortLabel}</Link>
          {APP_LINKS.login && <Link href={APP_LINKS.login} className="hover:text-ink">Sign in</Link>}
          {APP_LINKS.privacy && <Link href={APP_LINKS.privacy} className="hover:text-ink">Privacy</Link>}
        </nav>
        <p className="w-full text-xs text-faint sm:w-auto">Videos and covers on this page were rendered by Distribution for LabelWise.</p>
      </div>
      <InView className="footer-mark mx-auto mt-10 max-w-[1120px] overflow-hidden" threshold={0.3}>
        <svg viewBox="0 0 1000 170" className="block w-full" aria-hidden>
          <text x="500" y="150" textAnchor="middle" className="wordmark-draw stroke-hairline-strong font-sans text-[190px] font-semibold tracking-tight" strokeWidth="1.5">
            Distribution
          </text>
        </svg>
      </InView>
    </footer>
  );
}
