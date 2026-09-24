import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { buildBundle } from "./bundle";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { DEFAULT_THEME, KitProps, type Storyboard, type Theme } from "./schema";
import { BundlePool } from "./bundle-pool";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "index.ts");

export type CompositionId = "PromoVertical" | "PromoLandscape" | "PromoStorePortrait" | "PromoStoreLandscape";

export interface RenderProgress {
  (pct: number, renderedFrames: number, totalFrames: number): void;
}

export interface RenderOptions {
  storyboard: Storyboard;
  theme?: Theme;
  compositionId: CompositionId;
  outPath: string;
  /** Directory served as `staticFile()` root: the project's own public/ dir. */
  publicDir?: string;
  onProgress?: RenderProgress;
  /** Fail the render if no frame completes for this long (default 4 minutes). */
  stallTimeoutMs?: number;
  signal?: AbortSignal;
  crf?: number;
  /** Render only the first N frames — used by smoke tests. */
  frameRange?: [number, number];
  concurrency?: number;
}

const bundles = new BundlePool(ENTRY, async (publicDir, outDir) => {
  await buildBundle({
    entryPoint: ENTRY,
    publicDir,
    outDir,
  });
});

type Gl = NonNullable<Parameters<typeof renderMedia>[0]["chromiumOptions"]>["gl"];

function chromiumOptions(): { gl: Gl } {
  // `angle` is right on macOS with a GPU; CPU-only Linux containers want swangle.
  const gl = (process.env.REMOTION_GL ?? (os.platform() === "darwin" ? "angle" : "swangle")) as Gl;
  return { gl };
}

/** Render one composition to an MP4. Local, deterministic, no API key. */
export async function renderPromo(opts: RenderOptions): Promise<{ outPath: string; durationInFrames: number; fps: number; width: number; height: number }> {
  opts.signal?.throwIfAborted();
  opts = { ...opts, outPath: path.resolve(opts.outPath) };
  const theme = opts.theme ?? DEFAULT_THEME;
  const inputProps = KitProps.parse({ storyboard: opts.storyboard, theme });
  return bundles.use(opts.publicDir, async serveUrl => {
    const composition = await selectComposition({ serveUrl, id: opts.compositionId, inputProps, chromiumOptions: chromiumOptions() });
    opts.signal?.throwIfAborted();

    const total = opts.frameRange ? opts.frameRange[1] - opts.frameRange[0] + 1 : composition.durationInFrames;

    // A render that stops making progress must fail rather than hang: a wedged
    // browser, a stalled encode and a full disk all look like "2%" forever.
    const idleMs = opts.stallTimeoutMs ?? 4 * 60_000;
    let lastFrameAt = Date.now();
    let stalled = false;
    const abort = new AbortController();
    const onExternalAbort = () => abort.abort();
    opts.signal?.addEventListener("abort", onExternalAbort);
    const watchdog = setInterval(() => {
      if (Date.now() - lastFrameAt > idleMs) {
        stalled = true;
        abort.abort();
      }
    }, 15_000);
    watchdog.unref?.();

    try {
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: opts.outPath,
        inputProps,
        crf: opts.crf ?? 18,
        chromiumOptions: chromiumOptions(),
        concurrency: opts.concurrency ?? null,
        timeoutInMilliseconds: 120_000,
        ...(opts.frameRange ? { frameRange: opts.frameRange } : {}),
        onProgress: ({ renderedFrames }) => {
          lastFrameAt = Date.now();
          opts.onProgress?.(Math.min(100, Math.round((renderedFrames / Math.max(1, total)) * 100)), renderedFrames, total);
        },
        cancelSignal: (cb) => {
          if (abort.signal.aborted) cb();
          else abort.signal.addEventListener("abort", () => cb(), { once: true });
        },
      });
    } catch (err) {
      if (stalled) {
        throw new Error(`render of ${opts.compositionId} made no progress for ${Math.round(idleMs / 1000)}s and was stopped. Usually a full disk or a wedged headless browser.`);
      }
      throw err;
    } finally {
      clearInterval(watchdog);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
    return { outPath: opts.outPath, durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height };
  }, opts.signal);
}

/** One frame, for the visual-QA pass and for poster images. */
export async function renderPromoStill(opts: Omit<RenderOptions, "onProgress" | "crf" | "frameRange"> & { frame: number }): Promise<string> {
  opts.signal?.throwIfAborted();
  opts = { ...opts, outPath: path.resolve(opts.outPath) };
  const theme = opts.theme ?? DEFAULT_THEME;
  const inputProps = KitProps.parse({ storyboard: opts.storyboard, theme });
  return bundles.use(opts.publicDir, async serveUrl => {
    const composition = await selectComposition({ serveUrl, id: opts.compositionId, inputProps, chromiumOptions: chromiumOptions() });
    opts.signal?.throwIfAborted();
    let cancel: (() => void) | undefined;
    try {
      await renderStill({ composition, serveUrl, output: opts.outPath, inputProps, frame: opts.frame, chromiumOptions: chromiumOptions(), cancelSignal: callback => {
        cancel = callback;
        if (opts.signal?.aborted) callback();
        else opts.signal?.addEventListener("abort", callback, { once: true });
      } });
      return opts.outPath;
    } finally {
      if (cancel) opts.signal?.removeEventListener("abort", cancel);
    }
  }, opts.signal);
}

export * from "./schema";
