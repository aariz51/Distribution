import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { PutOptions, StorageAdapter, StoredObject } from "./adapter";
import { assertValidKey } from "./keys";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4a: "audio/mp4", mp3: "audio/mpeg",
  wav: "audio/wav", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  json: "application/json", md: "text/markdown", txt: "text/plain", srt: "application/x-subrip", ttf: "font/ttf",
};

export function guessContentType(key: string): string | undefined {
  const ext = path.extname(key).slice(1).toLowerCase();
  return MIME_BY_EXT[ext];
}

export class LocalStorage implements StorageAdapter {
  readonly kind = "local" as const;
  constructor(
    private readonly root: string,
    private readonly urlBase = "/api/files",
  ) {}

  private abs(key: string): string {
    assertValidKey(key);
    const p = path.resolve(this.root, key);
    const rootAbs = path.resolve(this.root) + path.sep;
    if (!p.startsWith(rootAbs)) throw new Error(`storage path escapes root: ${key}`);
    return p;
  }

  async localPathFor(key: string): Promise<string> {
    const p = this.abs(key);
    await mkdir(path.dirname(p), { recursive: true });
    return p;
  }

  async commit(key: string, opts?: PutOptions): Promise<StoredObject> {
    const p = this.abs(key);
    const s = await stat(p);
    return { key, size: s.size, contentType: opts?.contentType ?? guessContentType(key) };
  }

  async putFile(key: string, srcPath: string, opts?: PutOptions): Promise<StoredObject> {
    const p = await this.localPathFor(key);
    if (path.resolve(srcPath) !== p) await copyFile(srcPath, p);
    return this.commit(key, opts);
  }

  async putBuffer(key: string, data: Buffer, opts?: PutOptions): Promise<StoredObject> {
    const p = await this.localPathFor(key);
    await writeFile(p, data);
    return this.commit(key, opts);
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.abs(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.abs(key));
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.abs(key));
      return { key, size: s.size, contentType: guessContentType(key) };
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.abs(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertValidKey(prefix.endsWith("/") ? `${prefix}x` : prefix);
    await rm(path.resolve(this.root, prefix), { recursive: true, force: true });
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.urlBase}/${key}`;
  }
}
