/**
 * Reconcile the asset table against storage.
 *
 * An asset row whose file has gone (a deleted project directory, a failed
 * upload, a wiped volume) renders in the library as a card the user can click
 * and cannot play. That is worse than showing nothing. This marks those rows
 * `failed` with a reason rather than deleting them, so the history stays
 * honest and a human can decide whether to regenerate.
 *
 *   pnpm exec tsx scripts/reconcile-assets.ts [--apply]
 * Without --apply it only reports.
 */
import "./_env";
import { assets, closeDb, eq, getDb, sql } from "@distribution/db";
import { getStorage } from "@distribution/storage";

const apply = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const storage = getStorage();
  const rows = await db.select().from(assets);

  const orphaned: { id: string; type: string; key: string }[] = [];
  for (const r of rows) {
    const head = await storage.head(r.storageKey).catch(() => null);
    if (!head || head.size === 0) orphaned.push({ id: r.id, type: r.type, key: r.storageKey });
  }

  console.log(`${rows.length} assets, ${orphaned.length} with no usable file`);
  for (const o of orphaned) console.log(`  ${o.type.padEnd(22)} ${o.id.slice(0, 8)}  ${o.key}`);

  if (!apply) {
    console.log(orphaned.length ? "\nrun again with --apply to mark these failed" : "\nnothing to do");
  } else if (orphaned.length) {
    for (const o of orphaned) {
      await db
        .update(assets)
        .set({
          status: "failed",
          failureReason: "The generated file is no longer in storage. Regenerate this asset.",
          updatedAt: sql`now()`,
        })
        .where(eq(assets.id, o.id));
    }
    console.log(`\nmarked ${orphaned.length} assets failed`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
