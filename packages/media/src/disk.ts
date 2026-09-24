import { statfs } from "node:fs/promises";
import { PipelineError } from "@distribution/core";

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
  freePct: number;
}

export async function diskSpace(path: string): Promise<DiskSpace> {
  const s = await statfs(path);
  const freeBytes = s.bavail * s.bsize;
  const totalBytes = s.blocks * s.bsize;
  return { freeBytes, totalBytes, freePct: totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0 };
}

export const GB = 1024 ** 3;

/**
 * Refuse to start a render or an encode that the disk cannot hold.
 *
 * Without this, a full disk does not produce an error: ffmpeg and Chromium
 * block on write, the job sits at whatever percentage it reached, and the user
 * watches a progress bar that will never move. Failing here costs seconds and
 * says exactly what is wrong.
 */
export async function assertDiskSpace(path: string, needBytes: number, step: string): Promise<DiskSpace> {
  const space = await diskSpace(path);
  if (space.freeBytes < needBytes) {
    const need = (needBytes / GB).toFixed(1);
    const free = (space.freeBytes / GB).toFixed(1);
    throw new PipelineError(
      `not enough disk space for ${step}: needs about ${need} GB, ${free} GB free. Free space and retry.`,
      { retrySafe: true, step, details: { needBytes, freeBytes: space.freeBytes, freePct: Math.round(space.freePct) } },
    );
  }
  return space;
}

/**
 * Fails a long render that has stopped making progress. Remotion's own timeout
 * covers a single frame; this covers the whole job going quiet, which is what
 * a stalled encode, an exhausted disk or a wedged browser actually look like.
 */
export class StallWatchdog {
  private last = Date.now();
  private timer: NodeJS.Timeout | undefined;
  private stalled = false;

  constructor(
    private readonly idleMs: number,
    private readonly onStall: (idleMs: number) => void,
  ) {}

  start(): void {
    // Poll at a quarter of the idle budget so detection is proportional to the
    // timeout, bounded so a long render does not poll hot and a short one is
    // still checked in time.
    const every = Math.min(15_000, Math.max(25, Math.floor(this.idleMs / 4)));
    this.timer = setInterval(() => {
      const idle = Date.now() - this.last;
      if (idle > this.idleMs && !this.stalled) {
        this.stalled = true;
        this.onStall(idle);
      }
    }, every);
    this.timer.unref?.();
  }

  /** Call on every unit of real progress. */
  tick(): void {
    this.last = Date.now();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get hasStalled(): boolean {
    return this.stalled;
  }
}
