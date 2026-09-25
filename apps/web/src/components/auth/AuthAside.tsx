import { FilmSlate, Scissors, ShareNetwork } from "@phosphor-icons/react/dist/ssr";

const STEPS = [
  { icon: FilmSlate, title: "A launch film", body: "A 15-second film from your logo, with or without screenshots. App Store cuts included." },
  { icon: Scissors, title: "Clips from long video", body: "Vertical, captioned, titled, with a cover for each one." },
  { icon: ShareNetwork, title: "Posted where people are", body: "TikTok, YouTube, Instagram and more, on a schedule you approve." },
];

export function AuthAside() {
  return (
    <div className="max-w-[420px]">
      <p className="font-mono text-xs uppercase tracking-widest text-[#9aa19a]">What you get</p>
      <p className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-balance">You built the product. We get it in front of people.</p>
      <ul className="mt-10 space-y-6">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-white/15 text-[#7fd1b5]">
              <Icon size={18} aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-[#b9bfb9]">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
