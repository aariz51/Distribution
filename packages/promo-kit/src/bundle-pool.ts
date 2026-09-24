import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface Lease { users: number; directory?: string; ready: Promise<string> }

/** Share only overlapping renders. No completed render retains a temporary bundle. */
export class BundlePool {
  private readonly entries = new Map<string, Lease>();
  private builds: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  readonly root: string;

  constructor(private readonly namespace: string, private readonly create: (publicDir: string | undefined, outDir: string) => Promise<void>, root?: string) {
    this.root = path.resolve(root ?? path.join(os.tmpdir(), "distribution-remotion-bundles", createHash("sha256").update(namespace).digest("hex").slice(0, 20)));
  }

  private async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    // Recover only our own directories from a process proven to have exited.
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("bundle-")) continue;
      const directory = path.join(this.root, entry.name);
      let owner: { namespace?: string; hostname?: string; pid?: number };
      try { owner = JSON.parse(await readFile(path.join(directory, ".owner.json"), "utf8")); }
      catch { continue; }
      if (owner.namespace !== this.namespace || owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || owner.pid! > 2147483647) continue;
      try { process.kill(owner.pid!, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") await rm(directory, { recursive: true, force: true });
      }
    }
  }

  async use<T>(publicDir: string | undefined, operation: (directory: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const absolutePublicDir = publicDir ? path.resolve(publicDir) : undefined;
    const key = absolutePublicDir ?? "";
    let lease = this.entries.get(key);
    if (!lease) {
      const created: Lease = { users: 0, ready: Promise.resolve("") };
      created.ready = this.builds.then(async () => {
        this.initialized ??= this.initialize().catch(error => { this.initialized = undefined; throw error; });
        await this.initialized;
        const directory = await mkdtemp(path.join(this.root, "bundle-"));
        created.directory = directory;
        await writeFile(path.join(directory, ".owner.json"), JSON.stringify({ namespace: this.namespace, hostname: os.hostname(), pid: process.pid }));
        // Remotion changes cwd and does not restore it on every failure path.
        const cwd = process.cwd();
        try { await this.create(absolutePublicDir, directory); }
        finally { process.chdir(cwd); }
        return directory;
      });
      this.builds = created.ready.then(() => undefined, () => undefined);
      this.entries.set(key, created);
      lease = created;
    }
    lease.users++;
    try {
      // Bundling has no cancellation API. Await it before releasing its files.
      const directory = await lease.ready;
      signal?.throwIfAborted();
      return await operation(directory);
    } finally {
      lease.users--;
      if (!lease.users) {
        if (this.entries.get(key) === lease) this.entries.delete(key);
        if (lease.directory) await rm(lease.directory, { recursive: true, force: true }).catch(error => {
          console.warn("Could not remove completed Remotion bundle", error instanceof Error ? error.message : String(error));
        });
      }
    }
  }
}
