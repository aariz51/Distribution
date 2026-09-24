import { expect, it, vi } from "vitest";
vi.mock("../exec", () => ({ bin: () => "yt-dlp", run: vi.fn() }));
import { run } from "../exec";
import { normalizeSearchQuery, searchYoutube } from "../youtube-search";
it("normalizes a real topic and rejects empty, excessive and control input", () => {
  expect(normalizeSearchQuery("  food  nutrition podcast  ")).toBe("food nutrition podcast");
  for (const value of ["", "ab", "x".repeat(241), "ab\u0000cd"]) expect(() => normalizeSearchQuery(value)).toThrow();
});
it("searches bounded metadata only and removes short/live/unknown-duration results", async () => {
  vi.mocked(run).mockResolvedValue({ stdout: JSON.stringify({ entries: [
    { id: "eKQWFJmCWZE", title: "Long discussion", duration: 900 },
    { id: "01234567890", title: "Short", duration: 30 },
    { id: "01234567891", title: "Unknown" },
    { id: "01234567892", title: "Live", duration: 900, live_status: "is_live" },
    { id: "01234567893", title: "Too long", duration: 10801 },
  ] }), stderr: "", exitCode: 0, durationMs: 1 });
  const signal = new AbortController().signal;
  const results = await searchYoutube("food nutrition podcast", signal);
  expect(results).toHaveLength(1);
  expect(run).toHaveBeenCalledWith("yt-dlp", expect.arrayContaining(["--skip-download", "--", "https://www.youtube.com/results?search_query=food+nutrition+podcast&sp=EgIwAQ%253D%253D"]), expect.objectContaining({ timeoutMs: 120_000, signal }));
});
