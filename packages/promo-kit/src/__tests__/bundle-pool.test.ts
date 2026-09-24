import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { BundlePool } from "../bundle-pool";

function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

it("keeps a shared bundle until both consumers finish, then removes its actual directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "distribution-pool-test-"));
  const held = gate(), started = gate(); let calls = 0, directory = "";
  const pool = new BundlePool("unit-lease", async (_, dir) => { calls++; await writeFile(path.join(dir, "index.html"), "bundle"); }, root);
  try {
    const first = pool.use(root, async dir => { directory = dir; started.resolve(); await held.promise; expect(await readFile(path.join(dir, "index.html"), "utf8")).toBe("bundle"); });
    await started.promise;
    await pool.use(root, async dir => { expect(dir).toBe(directory); });
    expect(await readdir(root)).toHaveLength(1);
    held.resolve(); await first;
    expect(calls).toBe(1); expect(await readdir(root)).toEqual([]);
  } finally { held.resolve(); await rm(root, { recursive: true, force: true }); }
});

it("holds cancelled build files until settlement and allows a fresh retry after build failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "distribution-pool-test-"));
  const building = gate(), finish = gate(), abort = new AbortController(); let calls = 0;
  const pool = new BundlePool("unit-retry", async (_, dir) => {
    calls++; await writeFile(path.join(dir, "partial"), "partial");
    if (calls === 1) { building.resolve(); await finish.promise; throw new Error("build failed"); }
  }, root);
  try {
    const pending = pool.use(root, async () => { throw new Error("cancelled consumer must not run"); }, abort.signal);
    const rejection = expect(pending).rejects.toThrow("build failed");
    await building.promise; abort.abort(); expect(await readdir(root)).toHaveLength(1);
    finish.resolve(); await rejection; expect(await readdir(root)).toEqual([]);
    await pool.use(root, async dir => { expect(await readFile(path.join(dir, "partial"), "utf8")).toBe("partial"); });
    expect(calls).toBe(2); expect(await readdir(root)).toEqual([]);
  } finally { finish.resolve(); await rm(root, { recursive: true, force: true }); }
});

it("recovers initialization failures and deletes only proven dead owners in its own namespace", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "distribution-pool-test-")), root = path.join(parent, "pool");
  const namespace = "unit-orphan";
  const pool = new BundlePool(namespace, async () => undefined, root);
  try {
    await writeFile(root, "not a directory");
    await expect(pool.use(undefined, async () => undefined)).rejects.toThrow();
    await rm(root); await mkdir(root);
    const deadPid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }));
    for (const [name, owner] of Object.entries({ stale: { namespace, pid: deadPid }, live: { namespace, pid: process.pid }, foreign: { namespace: "other-project", pid: deadPid }, unknown: {} })) {
      const dir = path.join(root, `bundle-${name}`); await mkdir(dir);
      await writeFile(path.join(dir, ".owner.json"), JSON.stringify({ hostname: os.hostname(), ...owner }));
    }
    await pool.use(undefined, async () => undefined);
    expect((await readdir(root)).sort()).toEqual(["bundle-foreign", "bundle-live", "bundle-unknown"]);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
