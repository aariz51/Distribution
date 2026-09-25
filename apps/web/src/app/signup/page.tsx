import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, signupsOpen } from "@/lib/auth";
import { AuthFrame, safeNext } from "@/components/auth/AuthFrame";
import { AuthAside } from "@/components/auth/AuthAside";
import { SignupForm } from "@/components/auth/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a workspace · Distribution" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/products/new?welcome=1");
  if (await getSession()) redirect(next);
  return (
    <AuthFrame aside={<AuthAside />}>
      {signupsOpen() ? (
        <SignupForm next={next} />
      ) : (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Signing up is closed</h1>
          <p className="mt-2 text-sm text-muted">This installation is invite only. Ask its owner for an account.</p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium underline underline-offset-2">
            Sign in instead
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
