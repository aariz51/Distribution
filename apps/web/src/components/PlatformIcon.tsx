import { siFacebook, siInstagram, siPinterest, siThreads, siTiktok, siX, siYoutube, type SimpleIcon } from "simple-icons";
import { LinkedinLogo, ShareNetwork } from "@phosphor-icons/react/dist/ssr";

// Official marks from Simple Icons (CC0). LinkedIn is not distributed there, so
// it comes from Phosphor's logo set.
const MARKS: Record<string, SimpleIcon> = {
  tiktok: siTiktok,
  youtube: siYoutube,
  instagram: siInstagram,
  "instagram-standalone": siInstagram,
  facebook: siFacebook,
  x: siX,
  threads: siThreads,
  pinterest: siPinterest,
};

/** Brand colour for a provider, for small accents only. TikTok and X are black by brand. */
export function platformColor(platform: string): string {
  const mark = MARKS[platform];
  if (mark) return `#${mark.hex}`;
  if (platform.startsWith("linkedin")) return "#0A66C2";
  return "#14171A";
}

export function PlatformIcon({ platform, size = 16, className, colored = false }: { platform: string; size?: number; className?: string; colored?: boolean }) {
  const mark = MARKS[platform];
  const fill = colored ? platformColor(platform) : "currentColor";
  if (mark) {
    return (
      <svg role="img" aria-label={mark.title} viewBox="0 0 24 24" width={size} height={size} className={className} fill={fill}>
        <path d={mark.path} />
      </svg>
    );
  }
  if (platform.startsWith("linkedin")) return <LinkedinLogo size={size} weight="fill" className={className} color={colored ? fill : undefined} aria-label="LinkedIn" />;
  return <ShareNetwork size={size} className={className} aria-label={platform} />;
}
