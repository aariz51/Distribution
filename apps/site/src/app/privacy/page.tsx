import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Privacy · Distribution" };

const SECTIONS = [
  {
    title: "What we store",
    items: [
      "Your email address and a password hash (argon2). We never store the password itself.",
      "Your workspace name and the product profiles you create: names, descriptions, features, audience, colours and preferences.",
      "Files you upload or ask us to fetch: logos, screenshots and source videos, plus everything rendered from them.",
      "Your Postiz API key, encrypted, so approved posts can be sent. Your social media passwords never reach us.",
      "Records of jobs and estimated AI usage, so your workspace's monthly limit can be enforced.",
    ],
  },
  {
    title: "Who we send data to",
    items: [
      "AI providers, for transcription, storyboards, ranking and post copy: only the text or audio each step needs.",
      "Postiz, when you connect a channel or schedule an approved post.",
      "Nothing is sold, and nothing is posted anywhere without your approval.",
    ],
  },
  {
    title: "Your control",
    items: [
      "Everything in a workspace is visible only to that workspace.",
      "You can disconnect any channel from the Channels page at any time.",
      "To delete your workspace and its files, contact the operator of this installation.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-[680px] px-6 py-16">
      <Link href="/" className="inline-block rounded-md" aria-label="Distribution home">
        <Wordmark />
      </Link>
      <h1 className="mt-12 text-4xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-lg text-muted">What this app keeps, why, and where it goes. Written from what the software actually does.</p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="mt-12">
          <h2 className="text-xl font-semibold">{s.title}</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base text-muted">
            {s.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
