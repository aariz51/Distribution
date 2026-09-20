import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listProducts } from "@/lib/products";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const products = await listProducts(session.accountId);
  return (
    <AppShell email={session.email}>
      <PageHeader
        title="Products"
        description="Each product profile feeds every promo film, clip, thumbnail and post."
        action={
          <ButtonLink href="/products/new" variant="primary">
            New product
          </ButtonLink>
        }
      />
      {products.length === 0 ? (
        <EmptyState title="No products yet. Describe your product once and everything downstream reads from it." action={<ButtonLink href="/products/new" variant="primary">Describe your product</ButtonLink>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const pal = p.brand.palette;
            return (
              <li key={p.id}>
                <Link href={`/products/${p.id}`} className="surface group block h-full p-5 motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-hairline-strong hover:shadow-[var(--shadow-raise)]">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-hairline bg-canvas text-sm font-semibold text-muted" aria-hidden>
                      {pal?.accent ? (
                        <span className="grid h-full w-full grid-cols-2 grid-rows-2">
                          <span style={{ background: pal.accent }} />
                          <span style={{ background: pal.ink }} />
                          <span style={{ background: pal.canvas }} />
                          <span style={{ background: pal.ground }} />
                        </span>
                      ) : (
                        p.product.name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{p.product.name}</h2>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.product.tagline}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    <span className="rounded-full border border-hairline px-2 py-0.5">{p.product.category.primary}</span>
                    <span className="rounded-full border border-hairline px-2 py-0.5 tabular-nums">v{p.version}</span>
                  </div>
                  <p className="mt-3 text-xs text-faint tabular-nums">
                    {p.product.features.length} {p.product.features.length === 1 ? "feature" : "features"} · {p.brand.screenshotAssetIds.length} {p.brand.screenshotAssetIds.length === 1 ? "screenshot" : "screenshots"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
