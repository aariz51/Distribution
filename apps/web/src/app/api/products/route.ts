import { ProductProfileInput } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { createProduct, listProducts } from "@/lib/products";

export const GET = handler(async () => {
  const s = await requireSession();
  return json({ products: await listProducts(s.accountId) });
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const input = ProductProfileInput.parse(await req.json());
  const product = await createProduct(s.accountId, input);
  return json({ product }, { status: 201 });
});
