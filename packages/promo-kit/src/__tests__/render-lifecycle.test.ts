import { beforeEach, expect, it, vi } from "vitest";
import { stat } from "node:fs/promises";
import { Storyboard } from "../schema";

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), select: vi.fn(), media: vi.fn(), still: vi.fn() }));
vi.mock("../bundle", () => ({ buildBundle: mocks.bundle }));
vi.mock("@remotion/renderer", () => ({ selectComposition: mocks.select, renderMedia: mocks.media, renderStill: mocks.still }));
const storyboard = Storyboard.parse({ fps: 30, durationFrames: 30, width: 1080, height: 1920, product: { name: "Lifecycle regression" }, logo: "logo.png", screens: {}, scenes: [{ id: "logo", kind: "logo", start: 0, duration: 30 }] });
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  mocks.bundle.mockImplementation(async ({ outDir }: { outDir?: string }) => outDir ?? "http://local-bundle");
  mocks.select.mockResolvedValue({ durationInFrames: 30, fps: 30, width: 1080, height: 1920 });
});
it("retries a failed bundle instead of retaining its rejected promise", async () => {
  const { renderPromoStill } = await import("../render");
  mocks.bundle.mockRejectedValueOnce(new Error("webpack failed"));
  const opts = { storyboard, compositionId: "PromoVertical" as const, outPath: "/unused.png", frame: 0 };
  await expect(renderPromoStill(opts)).rejects.toThrow("webpack failed");
  await expect(renderPromoStill(opts)).resolves.toBe(opts.outPath);
  expect(mocks.bundle).toHaveBeenCalledTimes(2);
});
it("does not start work for an already-cancelled render", async () => {
  const { renderPromo, renderPromoStill } = await import("../render");
  const signal = AbortSignal.abort();
  const opts = { storyboard, compositionId: "PromoVertical" as const, outPath: "/unused.mp4", signal };
  await expect(renderPromo(opts)).rejects.toThrow();
  await expect(renderPromoStill({ ...opts, frame: 0 })).rejects.toThrow();
  expect(mocks.bundle).not.toHaveBeenCalled();
});
it("honors cancellation during composition selection before starting a still", async () => {
  const { renderPromoStill } = await import("../render");
  const abort = new AbortController();
  mocks.select.mockImplementation(async () => { abort.abort(); return { durationInFrames: 30 }; });
  await expect(renderPromoStill({ storyboard, compositionId: "PromoVertical", outPath: "/unused.png", frame: 0, signal: abort.signal })).rejects.toThrow();
  expect(mocks.still).not.toHaveBeenCalled();
});
it("forwards active still cancellation and removes the failed render bundle", async () => {
  const { renderPromoStill } = await import("../render");
  const abort = new AbortController();
  mocks.still.mockImplementation(({ cancelSignal }: { cancelSignal: (callback: () => void) => void }) => new Promise((_, reject) => {
    cancelSignal(() => reject(new Error("still cancelled")));
    abort.abort();
  }));
  await expect(renderPromoStill({ storyboard, compositionId: "PromoVertical", outPath: "/unused.png", frame: 0, signal: abort.signal })).rejects.toThrow("still cancelled");
  const directory = mocks.bundle.mock.calls[0]![0].outDir as string;
  await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});
it("delivers cancellation that arrived before the video renderer registers its callback", async () => {
  const { renderPromo } = await import("../render");
  const abort = new AbortController();
  mocks.media.mockImplementation(({ cancelSignal }: { cancelSignal: (callback: () => void) => void }) => new Promise((_, reject) => {
    abort.abort();
    cancelSignal(() => reject(new Error("video cancelled")));
  }));
  await expect(renderPromo({ storyboard, compositionId: "PromoVertical", outPath: "/unused.mp4", signal: abort.signal })).rejects.toThrow("video cancelled");
  await expect(stat(mocks.bundle.mock.calls[0]![0].outDir as string)).rejects.toMatchObject({ code: "ENOENT" });
});
