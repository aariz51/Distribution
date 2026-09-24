/** Live connectivity check; --refresh also persists the actual channel cache. Never uploads or creates posts. */
import "./_env";
import { closeDb, getDb, postizConnections, eq } from "@distribution/db";
import { PostizClient, decryptSecret } from "../packages/publishing/src/index";
async function main() {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("Workspace secret is unavailable");
  const connections = await getDb().select().from(postizConnections);
  for (const connection of connections) {
    const client = new PostizClient({ apiUrl: connection.apiUrl, apiKey: decryptSecret(connection.apiKeyEnc, secret) });
    try {
      const channels = await client.listIntegrations(AbortSignal.timeout(60_000));
      if (process.argv.includes("--refresh")) await getDb().update(postizConnections).set({ channels, checkedAt: new Date(), updatedAt: new Date() }).where(eq(postizConnections.id, connection.id));
      console.log(JSON.stringify({ connectionId: connection.id, label: connection.label, channels: channels.map(c => ({ id: c.id, name: c.name, identifier: c.identifier, disabled: c.disabled })) }));
    } catch (error) {
      console.error(JSON.stringify({ connectionId: connection.id, error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  }
  if (!connections.length) throw new Error("No Postiz connections configured");
}
main().finally(closeDb).catch(error => { console.error(error.message); process.exitCode = 1; });
