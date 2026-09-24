import { Worker } from "node:worker_threads";

/** Resolve only after the bundler has exited, so cleanup cannot race its writes. */
export function buildBundle(options: { entryPoint: string; publicDir?: string; outDir: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./bundle-worker.mjs", import.meta.url), { workerData: options, execArgv: [] });
    let completed = false;
    let failure: Error | undefined;
    worker.on("message", message => { if (message === "complete") completed = true; });
    worker.once("error", error => { failure = error instanceof Error ? error : new Error(String(error)); });
    worker.once("exit", code => {
      if (failure) reject(failure);
      else if (code !== 0 || !completed) reject(new Error(`Remotion bundle worker exited before completion (${code})`));
      else resolve();
    });
  });
}
