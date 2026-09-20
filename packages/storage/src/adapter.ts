import type { Readable } from "node:stream";

export interface PutOptions {
  contentType?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string | undefined;
}

/** Every pipeline step talks to storage through this. Local FS today, S3/R2 later. */
export interface StorageAdapter {
  readonly kind: "local" | "s3";
  /** Absolute filesystem path a subprocess (ffmpeg/python) can read or write.
   *  For remote adapters this stages the object to a scratch dir. */
  localPathFor(key: string): Promise<string>;
  /** After a subprocess wrote to `localPathFor(key)`, persist it (no-op for local). */
  commit(key: string, opts?: PutOptions): Promise<StoredObject>;
  putFile(key: string, srcPath: string, opts?: PutOptions): Promise<StoredObject>;
  putBuffer(key: string, data: Buffer, opts?: PutOptions): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** URL the web app can hand to the browser. Local adapter returns an app route. */
  publicUrl(key: string): string;
}
