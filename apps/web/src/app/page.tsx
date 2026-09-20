import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listProducts } from "@/lib/products";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const products = await listProducts(session.accountId);
  return (
    <>
      <Nav email={session.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
            <p className="mt-1 text-sm text-zinc-600">Each product profile feeds every promo film, clip, thumbnail and post.</p>
          </div>
        </div>
        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <p className="text-zinc-700">No products yet.</p>
            <Link href="/products/new" className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm text-white">Describe your product once</Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <li key={p.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:shadow">
                <Link href={`/products/${p.id}`} className="block">
                  <div className="flex items-center gap-3">
                    <span className="inline-block h-8 w-8 rounded-md" style={{ background: p.brand.palette?.accent ?? "#e4e4e7" }} />
                    <div>
                      <h2 className="font-medium">{p.product.name}</h2>
                      <p className="text-xs text-zinc-500">v{p.version} · {p.product.category.primary}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-zinc-600">{p.product.tagline}</p>
                  <p className="mt-3 text-xs text-zinc-500">{p.product.features.length} features · {p.brand.screenshotAssetIds.length} screenshots</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
