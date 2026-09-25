import { redirect } from "next/navigation";
import { getSession, signupsOpen } from "@/lib/auth";
import { AuthFrame, safeNext } from "@/components/auth/AuthFrame";
import { AuthAside } from "@/components/auth/AuthAside";
import { LoginForm } from "@/components/auth/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Distribution" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/products");
  if (await getSession()) redirect(next);
  return (
    <AuthFrame aside={<AuthAside />}>
      <LoginForm next={next} signupsOpen={signupsOpen()} />
    </AuthFrame>
  );
}
