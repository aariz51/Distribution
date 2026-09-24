import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";
import { PipelineError, redact } from "@distribution/core";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  input?: string;
  /** Called with each stderr line (ffmpeg/yt-dlp/python progress). */
  onStderrLine?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
  step?: string;
  /** Exit codes other than 0 that are acceptable. */
  okExitCodes?: number[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

const STDERR_TAIL = 40;

/** A pipe chunk is not a line; tools may split both messages and UTF-8 characters. */
function readLines(stream: Readable, onLine: (line: string) => void): void {
  const decoder = new StringDecoder("utf8");
  let fragments: string[] = [];
  const drain = (text: string) => {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "\n" && text[i] !== "\r") continue;
      if (i > start) fragments.push(text.slice(start, i));
      if (fragments.length) onLine(fragments.join(""));
      fragments = [];
      start = i + 1;
    }
    if (start < text.length) fragments.push(text.slice(start));
  };
  stream.on("data", (chunk: Buffer) => drain(decoder.write(chunk)));
  stream.once("end", () => {
    drain(decoder.end());
    if (fragments.length) onLine(fragments.join(""));
    fragments = [];
  });
}

/** Spawn a binary with an argv array (never a shell), a hard timeout, abort
 *  signal support, line callbacks and a bounded stderr tail on failure. */
export async function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const execaOpts: ExecaOptions = {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    cancelSignal: opts.signal,
    input: opts.input,
    reject: false,
    all: false,
    stripFinalNewline: true,
    buffer: true,
    maxBuffer: 64 * 1024 * 1024,
  };
  const child: ResultPromise = execa(bin, args, execaOpts);
  const tail: string[] = [];
  const pushTail = (line: string) => {
    tail.push(line);
    if (tail.length > STDERR_TAIL) tail.shift();
  };
  if (child.stderr) {
    readLines(child.stderr, line => {
      pushTail(line);
      opts.onStderrLine?.(line);
    });
  }
  if (child.stdout && opts.onStdoutLine) {
    readLines(child.stdout, opts.onStdoutLine);
  }
  const res = await child;
  const durationMs = Date.now() - started;
  const exitCode = res.exitCode ?? -1;
  const ok = exitCode === 0 || (opts.okExitCodes?.includes(exitCode) ?? false);
  if (res.timedOut) {
    throw new PipelineError(`${bin} timed out after ${opts.timeoutMs} ms`, {
      retrySafe: true,
      step: opts.step,
      details: { bin, args: args.slice(0, 12), stderrTail: tail.map(redact) },
    });
  }
  if (res.isCanceled) {
    throw new PipelineError(`${bin} cancelled`, { retrySafe: false, step: opts.step, details: { bin } });
  }
  if (!ok) {
    throw new PipelineError(`${bin} exited ${exitCode}: ${redact(tail.slice(-3).join(" | "))}`, {
      retrySafe: false,
      step: opts.step,
      details: { bin, args: args.slice(0, 12), exitCode, stderrTail: tail.map(redact) },
    });
  }
  return { stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? ""), exitCode, durationMs };
}

export function bin(name: "ffmpeg" | "ffprobe" | "yt-dlp" | "python"): string {
  switch (name) {
    case "ffmpeg":
      return process.env.FFMPEG_BIN ?? "ffmpeg";
    case "ffprobe":
      return process.env.FFPROBE_BIN ?? "ffprobe";
    case "yt-dlp":
      return process.env.YTDLP_BIN ?? "yt-dlp";
    case "python":
      return process.env.PYTHON_BIN ?? "python3";
  }
}
