import Link from "next/link";
import type { ReactNode } from "react";
import { SubNav } from "@/components/ui/Tabs";
import { AccountMenu } from "@/components/AccountMenu";

export interface ProductContext {
  id: string;
  name: string;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-ink" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-canvas" />
      </span>
      Distribution
    </span>
  );
}

export function AppShell({ email, product, children }: { email: string; product?: ProductContext; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-6">
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Link href="/products" className="rounded-[6px] px-1.5 py-1 text-ink hover:bg-canvas">
              <Wordmark />
            </Link>
            <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
            <Link href="/products" className="rounded-[6px] px-2 py-1 text-muted motion-safe:transition-colors hover:bg-canvas hover:text-ink">
              Products
            </Link>
            <Link href="/channels" className="rounded-[6px] px-2 py-1 text-muted motion-safe:transition-colors hover:bg-canvas hover:text-ink">
              Channels
            </Link>
            {product && (
              <>
                <span className="text-faint" aria-hidden>/</span>
                <Link href={`/products/${product.id}`} className="truncate rounded-[6px] px-2 py-1 font-medium text-ink hover:bg-canvas">
                  {product.name}
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/products/new" className="inline-flex h-8 items-center rounded-[8px] bg-accent px-3 text-[13px] font-medium text-white motion-safe:transition-colors hover:bg-accent-hover">
              New product
            </Link>
            <AccountMenu email={email} />
          </div>
        </div>
        {product && (
          <div className="mx-auto w-full max-w-[1200px] px-6">
            <SubNav
              items={[
                { label: "Overview", href: `/products/${product.id}`, exact: true },
                { label: "Library", href: `/products/${product.id}/library` },
                { label: "Sources", href: `/products/${product.id}/sources` },
                { label: "Jobs", href: `/products/${product.id}/jobs` },
                { label: "Publish", href: `/products/${product.id}/publish` },
              ]}
            />
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">{children}</main>
    </>
  );
}

export function PageHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`mb-6 flex flex-wrap items-end justify-between gap-4 ${className ?? ""}`}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
