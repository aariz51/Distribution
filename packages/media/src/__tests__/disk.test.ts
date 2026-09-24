import { describe, expect, it } from "vitest";
import { GB, StallWatchdog, assertDiskSpace, diskSpace } from "../disk";

describe("disk guard", () => {
  it("reports real free space for a real path", async () => {
    const s = await diskSpace(process.cwd());
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.freeBytes).toBeGreaterThanOrEqual(0);
    expect(s.freePct).toBeGreaterThanOrEqual(0);
  });

  it("passes when the requirement is trivial", async () => {
    await expect(assertDiskSpace(process.cwd(), 1024, "render")).resolves.toBeDefined();
  });

  it("throws a retry-safe, actionable error when the disk cannot hold the job", async () => {
    // Ask for more than any disk has, so the guard must fire.
    await expect(assertDiskSpace(process.cwd(), 1_000_000 * GB, "render")).rejects.toMatchObject({
      retrySafe: true,
      step: "render",
    });
    await expect(assertDiskSpace(process.cwd(), 1_000_000 * GB, "render")).rejects.toThrow(/not enough disk space/);
  });
});

describe("stall watchdog", () => {
  it("fires when progress stops", async () => {
    let stalledFor = 0;
    const w = new StallWatchdog(60, (idle) => (stalledFor = idle));
    w.start();
    await new Promise((r) => setTimeout(r, 200));
    w.stop();
    expect(w.hasStalled).toBe(true);
    expect(stalledFor).toBeGreaterThan(0);
  });

  it("does not fire while progress keeps arriving", async () => {
    const w = new StallWatchdog(150, () => undefined);
    w.start();
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 40));
      w.tick();
    }
    w.stop();
    expect(w.hasStalled).toBe(false);
  });
});
