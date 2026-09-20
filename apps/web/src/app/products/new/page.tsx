import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { IntakeWizard } from "@/components/IntakeWizard";

export default async function NewProductPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <>
      <Nav email={session.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Describe your product once</h1>
        <IntakeWizard />
      </main>
    </>
  );
}
