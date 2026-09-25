import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { Untangle } from "@/components/landing/Untangle";
import { TaglineReveal } from "@/components/landing/TaglineReveal";
import { FeedStream } from "@/components/landing/FeedStream";
import { PromoSection } from "@/components/landing/PromoSection";
import { ClipSection } from "@/components/landing/ClipSection";
import { PublishSection } from "@/components/landing/PublishSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FAQ, Faq } from "@/components/landing/Faq";
import { FinalCta, LandingFooter } from "@/components/landing/FinalCta";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Distribution · anyone can build now, we get it seen",
  description:
    "Distribution turns your app into a launch film, captioned clips with covers, and posts scheduled to TikTok, YouTube and Instagram. Describe it once, approve what goes out.",
  openGraph: {
    title: "Anyone can build an app now. We get it seen.",
    description: "Launch films, captioned clips, covers and scheduled posts from one product profile.",
    images: [{ url: "/showcase/promo-landscape.jpg", width: 1280, height: 720, alt: "A launch film rendered by Distribution" }],
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default async function LandingPage() {
  const signedIn = Boolean(await getSession());
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only z-[60] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-canvas focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <LandingNav signedIn={signedIn} />
      <main id="main">
        <Hero signedIn={signedIn} />
        <Untangle />
        <section aria-label="What Distribution is for" className="overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-12 lg:grid-cols-[7fr_5fr]">
            <TaglineReveal lines={["You made something worth using.", "Now it shows up where people already look."]} />
            <div className="hidden lg:block">
              <FeedStream />
            </div>
          </div>
        </section>
        <PromoSection />
        <ClipSection />
        <PublishSection />
        <HowItWorks />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <LandingFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </div>
  );
}
