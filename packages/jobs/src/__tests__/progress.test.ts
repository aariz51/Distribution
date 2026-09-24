import { describe, expect, it, vi } from "vitest";
import { createProgressWriter } from "../progress";

/** Minimal Db stand-in: only the calls the writer makes. */
function fakeDb(behaviour: "ok" | "missing-job" | "boom") {
  const calls: string[] = [];
  const fail = () => {
    if (behaviour === "missing-job") {
      const e = new Error('insert or update on table "job_events" violates foreign key constraint') as Error & { code: string };
      e.code = "23503";
      throw e;
    }
    if (behaviour === "boom") throw new Error("connection terminated");
  };
  return {
    calls,
    db: {
      async transaction(fn: (tx: unknown) => Promise<void>) {
        calls.push("transaction");
        fail();
        await fn({
          update: () => ({ set: () => ({ where: async () => undefined }) }),
          insert: () => ({ values: async () => undefined }),
        });
      },
      insert() {
        calls.push("insert");
        return {
          values: async () => {
            fail();
          },
        };
      },
    } as never,
  };
}

describe("progress writer durability", () => {
  it("writes progress when the database is healthy", async () => {
    const { db, calls } = fakeDb("ok");
    const w = createProgressWriter(db, "job-1");
    await w.progress(10, "render", "frame 1");
    expect(calls).toContain("transaction");
    expect(w.abandoned).toBe(false);
  });

  it("never throws when the job row has been deleted mid-run", async () => {
    // This is the crash that used to end the worker process and every render
    // running inside it when a product was deleted during a render.
    const { db } = fakeDb("missing-job");
    const w = createProgressWriter(db, "job-gone");
    await expect(w.progress(50, "render", "frame 600")).resolves.toBeUndefined();
    await expect(w.event("info", "still going")).resolves.toBeUndefined();
    expect(w.abandoned).toBe(true);
  });

  it("stops writing once abandoned, so a doomed render is not also noisy", async () => {
    const { db, calls } = fakeDb("missing-job");
    const w = createProgressWriter(db, "job-gone");
    await w.progress(50, "render", "first");
    const after = calls.length;
    await w.progress(60, "render", "second");
    await w.event("warn", "third");
    expect(calls.length).toBe(after);
  });

  it("swallows ordinary database failures without abandoning the job", async () => {
    const { db } = fakeDb("boom");
    const w = createProgressWriter(db, "job-2");
    await expect(w.progress(25, "render", "blip")).resolves.toBeUndefined();
    // A transient error is not a deleted job: keep reporting.
    expect(w.abandoned).toBe(false);
  });

  it("clamps and coalesces so an ffmpeg tick loop cannot flood the table", async () => {
    const { db, calls } = fakeDb("ok");
    const w = createProgressWriter(db, "job-3");
    await w.progress(-20, "render");
    const first = calls.length;
    await w.progress(-5, "render");
    await w.progress(0, "render");
    expect(calls.length).toBe(first);
    vi.useRealTimers();
  });
});
