import Link from "next/link";

export function Nav({ email }: { email: string }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Distribution
        </Link>
        <nav className="flex items-center gap-5 text-sm text-zinc-600">
          <Link href="/" className="hover:text-zinc-900">Products</Link>
          <Link href="/products/new" className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700">New product</Link>
          <form action="/api/auth/logout" method="post">
            <button className="hover:text-zinc-900" title={email}>Sign out</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
