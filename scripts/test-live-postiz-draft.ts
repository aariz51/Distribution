/** Real SafeChoice upload + unpublished Postiz draft. Never schedules or publishes. */
import "./_env";
import path from "node:path";
import { createHash } from "node:crypto";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { closeDb, eq, getDb, loadProductProfile, postizConnections } from "@distribution/db";
import { PostizClient, decryptSecret, type UploadedMedia } from "../packages/publishing/src/index";
import { assertDecodableVideo, probeMedia } from "@distribution/media";
import { getStorage } from "@distribution/storage";

interface State { date: string; phase: string; fileSha256: string; caption: string; media?: UploadedMedia; postId?: string; raw?: unknown; uploadedBytesVerified?: number }
async function main() {
  if (process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Live connection is in the main workspace");
  const db = getDb(), secret = process.env.APP_SECRET;
  if (!secret) throw new Error("Workspace secret unavailable");
  const connection = (await db.select().from(postizConnections).where(eq(postizConnections.id, "c112f40d-df42-49c7-9eab-2b89002cb02c")))[0];
  const profile = await loadProductProfile(db, "6cc41ef3-7761-4520-b843-361ce1b8bca7");
  if (!connection || !profile || profile.product.name !== "SafeChoice" || connection.accountId !== profile.accountId) throw new Error("SafeChoice connection ownership mismatch");
  const client = new PostizClient({ apiUrl: connection.apiUrl, apiKey: decryptSecret(connection.apiKeyEnc, secret) });
  const signal = AbortSignal.timeout(180_000);
  const channels = await client.listIntegrations(signal);
  const channel = channels.find(c => c.id === "cmu5oan7n05zfmc0yxlllsgi6" && c.name === "SafeChoice" && c.identifier === "instagram-standalone" && !c.disabled);
  if (!channel) throw new Error("Expected active SafeChoice Instagram channel is unavailable");
  const file = await getStorage().localPathFor("promo/9e0ce875-5236-4494-b179-b184ce3c660b/out/promo_vertical.mp4");
  const probe = await probeMedia(file, { signal });
  if (probe.width !== 1080 || probe.height !== 1920 || Math.abs(probe.durationSec - 18) > .1) throw new Error("Real SafeChoice promo contract failed");
  await assertDecodableVideo(file, probe.durationSec, signal);
  const fileSha256 = createHash("sha256").update(await readFile(file)).digest("hex");
  const stateFile = path.resolve(import.meta.dirname, "../storage/tmp/live-postiz-safechoice-draft.json");
  // Never automatically break this lock: a crashed run may have submitted a draft.
  const lockFile = `${stateFile}.lock`;
  const lock = await open(lockFile, "wx", 0o600);
  try {
    let state: State;
    try { state = JSON.parse(await readFile(stateFile, "utf8")) as State; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const caption = [profile.product.name, profile.product.tagline, profile.product.urls.website].filter(Boolean).join("\n\n");
      state = { date: new Date(Date.now() + 7 * 86400000).toISOString(), phase: "prepared", fileSha256, caption };
      await writeFile(stateFile, JSON.stringify(state, null, 2), { flag: "wx" });
    }
    if (state.fileSha256 !== fileSha256) throw new Error("Test input changed; inspect the existing draft before another submission");
    if (!state.postId) {
      if (!["prepared", "uploaded"].includes(state.phase)) throw new Error("Previous create outcome is uncertain; check Postiz rather than resubmitting");
      if (!state.media) {
        state.media = await client.uploadFile(file, { contentType: "video/mp4", signal, validateMedia: async () => fileSha256 });
        state.phase = "uploaded";
        await writeFile(stateFile, JSON.stringify(state, null, 2));
      }
      if (!state.media.id || !state.media.path) throw new Error("Postiz did not return uploaded media identity and path");
      state.phase = "create-requested";
      await writeFile(stateFile, JSON.stringify(state, null, 2));
      const created = await client.createPost({ type: "draft", date: state.date, posts: [{ integrationId: channel.id, provider: channel.identifier, content: state.caption, media: [state.media] }] }, signal);
      state.raw = created.raw;
      await writeFile(stateFile, JSON.stringify(state, null, 2));
      if (!created.id?.trim() || created.ids.length !== 1 || created.ids[0] !== created.id) throw new Error("Draft response requires manual reconciliation");
      state.postId = created.id;
      state.phase = "created";
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    }
    const remote = await client.getPost(state.postId, signal, new Date(state.date));
    const raw = remote.raw as { state?: string; integration?: { id?: string }; content?: string };
    if (raw.state !== "DRAFT" || remote.publishedUrl || raw.integration?.id !== channel.id) throw new Error(`Draft not verified: state=${raw.state ?? "missing"}; inspect Postiz before continuing`);
    if (!state.media?.path) throw new Error("Saved upload URL is missing");
    const response = await fetch(state.media.path, { signal });
    if (!response.ok || !response.body) throw new Error("Uploaded video could not be retrieved");
    const uploadedHash = createHash("sha256");
    let uploadedBytes = 0;
    for await (const chunk of response.body) {
      uploadedBytes += chunk.byteLength;
      if (uploadedBytes > probe.sizeBytes!) throw new Error("Uploaded video exceeds original size");
      uploadedHash.update(chunk);
    }
    if (uploadedBytes !== probe.sizeBytes || uploadedHash.digest("hex") !== fileSha256) throw new Error("Uploaded media does not match the verified SafeChoice output");
    state.uploadedBytesVerified = uploadedBytes;
    state.phase = "verified-draft";
    state.raw = remote.raw;
    await writeFile(stateFile, JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ postId: state.postId, channel: channel.name, state: raw.state, media: state.media, fileSha256, uploadedBytesVerified: uploadedBytes, caption: state.caption, published: false }));
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
main().finally(closeDb).catch(error => { console.error(error.message); process.exitCode = 1; });
