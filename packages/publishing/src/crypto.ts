import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Secrets at rest (Postiz API keys) use AES-256-GCM with a key derived from
 *  APP_SECRET. Wire format: base64(iv).base64(tag).base64(ciphertext). */
function keyFor(appSecret: string): Buffer {
  if (!appSecret) throw new Error("APP_SECRET is required to encrypt secrets");
  return createHash("sha256").update(appSecret, "utf8").digest();
}

export function encryptSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(appSecret), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(enc: string, appSecret: string): string {
  const parts = enc.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted secret");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64")) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv("aes-256-gcm", keyFor(appSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
