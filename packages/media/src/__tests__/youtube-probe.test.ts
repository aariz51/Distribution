import { beforeEach, expect, it, vi } from "vitest";
import { PipelineError } from "@distribution/core";
const execute = vi.hoisted(() => vi.fn());
vi.mock("../exec", () => ({ run: execute, bin: (name: string) => name }));
import { probeYoutube } from "../youtube-probe";
const url = "https://www.youtube.com/watch?v=eKQWFJmCWZE";
beforeEach(() => { execute.mockReset(); });
it("tries another client for a transient process exit despite the generic process error's retry flag", async () => {
  execute.mockRejectedValueOnce(new PipelineError("exit 1", { retrySafe: false, details: { stderrTail: ["HTTP Error 429"] } })).mockResolvedValueOnce({ stdout: JSON.stringify({ title: "Video", duration: 211 }) });
  expect((await probeYoutube(url, new AbortController().signal)).duration).toBe(211);
  expect(execute).toHaveBeenCalledTimes(2);
});
it("does not repeatedly probe a private video", async () => {
  execute.mockRejectedValue(new PipelineError("exit 1", { details: { stderrTail: ["This video is private"] } }));
  await expect(probeYoutube(url, new AbortController().signal)).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
});
it("does not continue fallback after caller cancellation", async () => {
  const controller = new AbortController();
  execute.mockImplementation(async () => { controller.abort(new Error("cancelled by caller")); throw new Error("process stopped"); });
  await expect(probeYoutube(url, controller.signal)).rejects.toThrow("cancelled by caller");
  expect(execute).toHaveBeenCalledTimes(1);
});
it("rejects a live or incomplete duration instead of saving it as a usable source", async () => {
  execute.mockResolvedValue({ stdout: JSON.stringify({ title: "Live video", duration: 0 }) });
  await expect(probeYoutube(url, new AbortController().signal)).rejects.toThrow("no usable duration");
  expect(execute).toHaveBeenCalledTimes(1);
});
