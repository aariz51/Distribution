import { parentPort, workerData } from "node:worker_threads";
import { bundle } from "@remotion/bundler";

// Remotion skips its process.chdir calls off the main thread. A bundle must
// not change the working directory underneath concurrent pipeline operations.
await bundle({ ...workerData, onProgress: () => undefined });
parentPort.postMessage("complete");
parentPort.close();
