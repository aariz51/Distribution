import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { DEFAULT_THEME, KitProps, type Storyboard, type Theme } from "./schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "index.ts");

export type CompositionId = "PromoVertical" | "PromoLandscape" | "PromoStorePortrait" | "PromoStoreLandscape";

export interface RenderOptions {
  storyboard: Storyboard;
  theme?: Theme;
  compositionId: CompositionId;
  outPath: string;
  /** Directory served as `staticFile()` root: the project's own public/ dir. */
  publicDir?: string;
  onProgress?: (pct: number, renderedFrames: number, totalFrames: number) => void;
  signal?: AbortSignal;
  crf?: number;
  /** Render only the first N frames — used by smoke tests. */
  frameRange?: [number, number];
  concurrency?: number;
}

let bundlePromise: Promise<string> | undefined;
let bundledPublicDir: string | undefined;

/** Bundling is the slow part (~10-20 s), so it is cached per public dir. */
async function getBundle(publicDir: string | undefined): Promise<string> {
  if (bundlePromise && bundledPublicDir === publicDir) return bundlePromise;
  bundledPublicDir = publicDir;
  bundlePromise = bundle({
    entryPoint: ENTRY,
    publicDir,
    onProgress: () => undefined,
    // Remotion's own webpack config is enough for the kit; no overrides needed.
  });
  return bundlePromise;
}

type Gl = NonNullable<Parameters<typeof renderMedia>[0]["chromiumOptions"]>["gl"];

function chromiumOptions(): { gl: Gl } {
  // `angle` is right on macOS with a GPU; CPU-only Linux containers want swangle.
  const gl = (process.env.REMOTION_GL ?? (os.platform() === "darwin" ? "angle" : "swangle")) as Gl;
  return { gl };
}

/** Render one composition to an MP4. Local, deterministic, no API key. */
export async function renderPromo(opts: RenderOptions): Promise<{ outPath: string; durationInFrames: number; fps: number; width: number; height: number }> {
  const theme = opts.theme ?? DEFAULT_THEME;
  const inputProps = KitProps.parse({ storyboard: opts.storyboard, theme });
  const serveUrl = await getBundle(opts.publicDir);
  const composition = await selectComposition({ serveUrl, id: opts.compositionId, inputProps, chromiumOptions: chromiumOptions() });

  const total = opts.frameRange ? opts.frameRange[1] - opts.frameRange[0] + 1 : composition.durationInFrames;
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
      opts.onProgress?.(Math.min(100, Math.round((renderedFrames / Math.max(1, total)) * 100)), renderedFrames, total);
    },
    cancelSignal: opts.signal
      ? (cb) => {
          opts.signal?.addEventListener("abort", () => cb());
        }
      : undefined,
  });
  return { outPath: opts.outPath, durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height };
}

/** One frame, for the visual-QA pass and for poster images. */
export async function renderPromoStill(opts: Omit<RenderOptions, "onProgress" | "crf" | "frameRange"> & { frame: number }): Promise<string> {
  const theme = opts.theme ?? DEFAULT_THEME;
  const inputProps = KitProps.parse({ storyboard: opts.storyboard, theme });
  const serveUrl = await getBundle(opts.publicDir);
  const composition = await selectComposition({ serveUrl, id: opts.compositionId, inputProps, chromiumOptions: chromiumOptions() });
  await renderStill({ composition, serveUrl, output: opts.outPath, inputProps, frame: opts.frame, chromiumOptions: chromiumOptions() });
  return opts.outPath;
}

export * from "./schema";
