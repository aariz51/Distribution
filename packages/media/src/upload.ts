import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import os from "node:os";
import path from "node:path";
import { ValidationError } from "@distribution/core";

export interface StagedUpload { path: string; name: string; contentType: string; size: number; fields: Record<string, string> }

/** Bounded multipart parsing. Only the callback may retain a copy of the file. */
export async function withStagedUpload<T>(request: Request, opts: { maxBytes: number; scratchRoot?: string; timeoutMs?: number }, consume: (upload: StagedUpload) => Promise<T>): Promise<T> {
  const maxBody = opts.maxBytes + 64 * 1024;
  const advertised = Number(request.headers.get("content-length") ?? 0);
  if (advertised > maxBody) throw new ValidationError("File too large");
  if (!request.body) throw new ValidationError("Upload body missing");
  let parser: ReturnType<typeof busboy>;
  try { parser = busboy({ headers: { "content-type": request.headers.get("content-type") ?? "" }, limits: { fileSize: opts.maxBytes + 1, files: 1, fields: 8, fieldSize: 4096, parts: 9, headerPairs: 32 }, highWaterMark: 64 * 1024, fileHwm: 64 * 1024 }); }
  catch { throw new ValidationError("Invalid multipart upload"); }
  const directory = await mkdtemp(path.join(opts.scratchRoot ?? process.env.SCRATCH_ROOT ?? os.tmpdir(), "distribution-upload-"));
  const target = path.join(directory, "input");
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(opts.timeoutMs ?? 30 * 60_000)]);
  const writes: Promise<void>[] = [];
  let failure: Error | undefined;
  let fileInfo: { name: string; contentType: string } | undefined;
  const fields: Record<string, string> = Object.create(null);
  const fail = (error: Error) => { failure ??= error; abort.abort(error); };
  parser.on("file", (field, file, info) => {
    if (field !== "file" || fileInfo) { file.resume(); fail(new ValidationError("Upload exactly one file named file")); return; }
    fileInfo = { name: path.basename(info.filename).slice(0, 255), contentType: info.mimeType };
    file.on("limit", () => fail(new ValidationError("File too large")));
    writes.push(pipeline(file, createWriteStream(target, { flags: "wx", mode: 0o600 }), { signal }).catch(error => { fail(error); }));
  });
  parser.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated || Object.hasOwn(fields, name)) { fail(new ValidationError("Invalid or duplicate upload field")); return; }
    fields[name] = value;
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) parser.on(event, () => fail(new ValidationError("Too many upload parts")));
  let received = 0;
  const bounded = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    callback(received > maxBody ? new ValidationError("Upload body too large") : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), bounded, parser, { signal });
    await Promise.all(writes);
    if (failure) throw failure;
    if (!fileInfo) throw new ValidationError("File missing");
    const size = (await stat(target)).size;
    if (!size) throw new ValidationError("File is empty");
    if (size > opts.maxBytes) throw new ValidationError("File too large");
    return await consume({ path: target, ...fileInfo, size, fields });
  } catch (error) {
    const cause = failure ?? error;
    if (cause instanceof Error && /Unexpected end of (form|file)/i.test(cause.message)) throw new ValidationError("Upload was incomplete. Try again.");
    if ((cause as NodeJS.ErrnoException).code === "ENOSPC") throw new ValidationError("Not enough storage for this upload");
    if (signal.aborted && !(cause instanceof ValidationError)) throw new ValidationError("Upload interrupted or timed out. Try again.");
    throw cause;
  } finally {
    abort.abort();
    await Promise.allSettled(writes);
    await rm(directory, { recursive: true, force: true });
  }
}
