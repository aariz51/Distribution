import { expect, it } from "vitest";
import { canonicalChannel, parseChannelVideos } from "../channel";
it("canonicalizes channel tabs to videos", () => {
  expect(canonicalChannel("https://youtube.com/@BBC/featured?view=0")).toBe("https://www.youtube.com/@BBC/videos");
});
it.each(["http://youtube.com/@BBC", "https://youtube.com.evil.test/@BBC", "https://user@youtube.com/@BBC", "https://youtube.com:4433/@BBC", "https://youtube.com/watch?v=eKQWFJmCWZE", "https://youtube.com/results?search_query=food", "https://youtube.com/playlist?list=abc"]) ("rejects non-channel input %s", input => { expect(() => canonicalChannel(input)).toThrow(); });
it("deduplicates real IDs and excludes live, upcoming and malformed entries", () => {
  const entry = { id: "eKQWFJmCWZE", title: "Recorded video", duration: 211 };
  const result = parseChannelVideos(JSON.stringify({ entries: [entry, entry, { ...entry, id: "01234567890", live_status: "is_live" }, { ...entry, id: "01234567891", live_status: "is_upcoming" }, { id: "invalid", title: "broken" }] }));
  expect(result).toHaveLength(1); expect(result[0]!.durationSec).toBe(211); expect(result[0]!.url).toBe("https://www.youtube.com/watch?v=eKQWFJmCWZE");
});
it("rejects malformed extraction instead of claiming an empty successful channel", () => {
  expect(() => parseChannelVideos("not json")).toThrow(); expect(() => parseChannelVideos("{}")).toThrow();
});

it("canonicalizes Unicode and encoded handles identically", () => {
  const raw = "https://youtube.com/@日本語/videos";
  expect(canonicalChannel(raw)).toBe(canonicalChannel("https://youtube.com/@%E6%97%A5%E6%9C%AC%E8%AA%9E/featured"));
  expect(canonicalChannel(canonicalChannel(raw))).toBe(canonicalChannel(raw));
});
it.each(["https://youtube.com/@bad%ZZ", "https://youtube.com/@bad%2Fhandle", "https://youtube.com/@bad%3Fhandle"])("rejects malformed or encoded handle separators %s", input => { expect(() => canonicalChannel(input)).toThrow(); });
