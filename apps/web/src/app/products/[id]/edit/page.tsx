import captionStyles from "../../../../../../../vendor/autoshorts-py/assets/caption_styles.json";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProductEditor } from "@/components/ProductEditor";
import { getSession } from "@/lib/auth";
import { getProduct } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Edit product</h1>
      <p className="mt-1 text-sm text-muted">Changes apply to new runs. Existing videos and runs keep their saved settings.</p>
      <ProductEditor initial={product} captionPresets={captionStyles.presets.map(({ id, name }) => ({ id, name }))} />
    </AppShell>
  );
}
