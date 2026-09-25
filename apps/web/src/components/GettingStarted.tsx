import Link from "next/link";
import { CheckCircle, FilmSlate, PaperPlaneTilt, Plugs, Scissors } from "@phosphor-icons/react/dist/ssr";

interface Step {
  done: boolean;
  title: string;
  body: string;
  href: string;
  cta: string;
  icon: typeof FilmSlate;
}

/** The four moves from a fresh product to a published post, ticked off from real data. */
export function GettingStarted({ productId, progress, channels }: { productId: string; progress: { promos: number; clips: number; scheduled: number }; channels: number }) {
  const steps: Step[] = [
    { done: progress.promos > 0, title: "Make a promo", body: "A 15-second launch film from your logo and profile, in four sizes.", href: `/products/${productId}#promo`, cta: "Use Generate promo above", icon: FilmSlate },
    { done: progress.clips > 0, title: "Clip a video", body: "Upload or link a long video; get captioned vertical clips.", href: `/products/${productId}/sources`, cta: "Add a source", icon: Scissors },
    { done: channels > 0, title: "Connect channels", body: "TikTok, YouTube, Instagram and more, once per workspace.", href: "/channels", cta: "Connect", icon: Plugs },
    { done: progress.scheduled > 0, title: "Schedule a post", body: "Approve what is good and put it on the calendar.", href: `/products/${productId}/publish`, cta: "Open Publish", icon: PaperPlaneTilt },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null;
  return (
    <section aria-labelledby="getting-started" className="mt-8 rounded-[10px] border border-hairline bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-5 py-3">
        <h2 id="getting-started" className="text-sm font-semibold">Get started</h2>
        <span className="text-xs text-muted tabular-nums">
          {steps.length - remaining} of {steps.length} done
        </span>
      </div>
      <ol className="grid divide-hairline sm:grid-cols-2 sm:divide-x lg:grid-cols-4">
        {steps.map(({ done, title, body, href, cta, icon: Icon }, i) => (
          <li key={title} className="border-hairline p-5 max-sm:border-b max-sm:last:border-b-0">
            <div className="flex items-center gap-2">
              {done ? <CheckCircle size={18} weight="fill" className="text-accent" aria-label="Done" /> : <Icon size={18} className="text-muted" aria-hidden />}
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
            </div>
            <h3 className={`mt-3 text-sm font-semibold ${done ? "text-muted line-through decoration-hairline-strong" : ""}`}>{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
            {!done && (
              <Link href={href} className="mt-3 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline">
                {cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
