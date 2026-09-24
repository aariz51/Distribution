import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp } from "node:fs/promises";

export const KIT_ROOT = fileURLToPath(new URL("../../../promo-kit/", import.meta.url));
const BUNDLED_SFX = fileURLToPath(new URL("../../../../vendor/promo-video/template/public/sfx/", import.meta.url));

/** Use tracked source assets so clean checkouts render the same sound design. */
export async function stageRuntimeAssets(publicDir: string): Promise<void> {
  await cp(path.join(KIT_ROOT, "public/fonts"), path.join(publicDir, "fonts"), { recursive: true });
  await cp(BUNDLED_SFX, path.join(publicDir, "sfx"), { recursive: true });
}
