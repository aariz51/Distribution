"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { APP_LINKS } from "@/lib/app-links";

const LINKS = [
  { href: "#promo", label: "Promo films" },
  { href: "#clips", label: "Clips" },
  { href: "#publish", label: "Publishing" },
  { href: "#faq", label: "FAQ" },
];

/** Floating island nav; on small screens it opens into a full glass sheet. */
export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Transparent over the hero; a surface as soon as the page has moved.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      nav.dataset.scrolled = String(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const primary = signedIn ? { href: APP_LINKS.workspace, label: "Open your workspace" } : { href: APP_LINKS.signup, label: APP_LINKS.signupShortLabel };

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:pt-6">
        <nav ref={navRef} aria-label="Main" data-scrolled="false" className="landing-nav pointer-events-auto relative flex w-full max-w-[1120px] items-center justify-between gap-2 overflow-hidden rounded-full border py-2 pl-4 pr-2 data-[scrolled=true]:max-w-[880px]">
          <span className="nav-progress absolute inset-x-6 bottom-0 h-px bg-accent" aria-hidden />
          <Link href="/" className="rounded-full" aria-label="Distribution home">
            <Wordmark />
          </Link>
          <ul className="hidden items-center gap-1 text-sm md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="rounded-full px-3 py-2 text-muted motion-safe:transition-colors motion-safe:duration-200 hover:bg-canvas hover:text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            {!signedIn && APP_LINKS.login && (
              <Link href={APP_LINKS.login} className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas sm:inline-block">
                Sign in
              </Link>
            )}
            <Link href={primary.href} className="landing-cta-sm">
              {primary.label}
            </Link>
            <button
              type="button"
              className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-canvas md:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((v) => !v)}
            >
              <span className={`absolute h-0.5 w-4 rounded-full bg-ink landing-ease duration-500 ${open ? "rotate-45" : "-translate-y-1"}`} />
              <span className={`absolute h-0.5 w-4 rounded-full bg-ink landing-ease duration-500 ${open ? "-rotate-45" : "translate-y-1"}`} />
            </button>
          </div>
        </nav>
      </header>
      <div
        id="mobile-menu"
        className={`fixed inset-0 z-40 bg-surface/80 backdrop-blur-3xl landing-ease duration-500 md:hidden ${open ? "visible opacity-100" : "invisible opacity-0"}`}
        onClick={() => setOpen(false)}
      >
        <ul className="flex h-full flex-col justify-center gap-2 px-8">
          {[...LINKS, ...(signedIn || !APP_LINKS.login ? [] : [{ href: APP_LINKS.login, label: "Sign in" }])].map((l, i) => (
            <li key={l.href} className="overflow-hidden">
              <a
                href={l.href}
                className={`block py-2 text-3xl font-semibold tracking-tight landing-ease duration-700 ${open ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}
                style={{ transitionDelay: open ? `${100 + i * 50}ms` : "0ms" }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
