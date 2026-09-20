import { describe, expect, it } from "vitest";
import {
  PLAYER_CLIENTS,
  YTDLP_FORMAT,
  YoutubeDownloadError,
  canonicalUrl,
  classify,
  downloadArgv,
  firstMeaningfulLine,
  isRetryable,
  isVideoId,
  parseDownloadOutput,
  parseVideoId,
  parseVideoMeta,
  playerClientArgv,
  probeArgv,
  reuseAllowed,
  userMessage,
  ytdlpAttempts,
  type DownloadFailure,
} from "../youtube";

function invalidUrlError(input: string): YoutubeDownloadError {
  try {
    parseVideoId(input);
  } catch (e) {
    expect(e).toBeInstanceOf(YoutubeDownloadError);
    return e as YoutubeDownloadError;
  }
  throw new Error(`accepted input: ${JSON.stringify(input)}`);
}

// One-to-one with youtube.rs `mod tests`.
describe("youtube (youtube.rs tests)", () => {
  it("parses_every_link_shape_people_actually_paste", () => {
    const cases = [
      "https://www.youtube.com/watch?v=X2oNmdGVBoc",
      "https://youtube.com/watch?v=X2oNmdGVBoc",
      "http://m.youtube.com/watch?v=X2oNmdGVBoc",
      "https://youtu.be/X2oNmdGVBoc",
      "youtu.be/X2oNmdGVBoc",
      "www.youtube.com/watch?v=X2oNmdGVBoc",
      "https://www.youtube.com/shorts/X2oNmdGVBoc",
      "https://www.youtube.com/embed/X2oNmdGVBoc",
      "https://www.youtube.com/live/X2oNmdGVBoc",
      // Extra params, and the id not being first.
      "https://www.youtube.com/watch?list=PL123&v=X2oNmdGVBoc&t=42s",
      "https://youtu.be/X2oNmdGVBoc?t=42",
      "  https://youtu.be/X2oNmdGVBoc  ",
      "X2oNmdGVBoc",
    ];
    for (const c of cases) {
      expect(parseVideoId(c), `failed on ${c}`).toBe("X2oNmdGVBoc");
    }
  });

  it("refuses_anything_that_is_not_youtube", () => {
    const hostile = [
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.test/watch?v=X2oNmdGVBoc",
      "ytsearch10:credit card numbers",
      "/Users/someone/.ssh/id_rsa",
      // Looks like YouTube, resolves to evil.test.
      "https://www.youtube.com@evil.test/watch?v=X2oNmdGVBoc",
      "https://notyoutube.com/watch?v=X2oNmdGVBoc",
      "",
      "   ",
    ];
    for (const c of hostile) {
      const err = invalidUrlError(c);
      expect(err.kind, `accepted hostile input: ${JSON.stringify(c)}`).toBe("InvalidUrl");
    }
  });

  it("refuses_argument_injection_shapes", () => {
    for (const c of ["--exec=curl evil.test", "-o/tmp/pwned", "--config-location=/tmp/evil.conf"]) {
      expect(() => parseVideoId(c), `accepted flag-shaped input: ${c}`).toThrow(YoutubeDownloadError);
    }
  });

  it("rejects_ids_of_the_wrong_length_or_alphabet", () => {
    for (const bad of ["short", "waytoolongvideoid", "has spaces", "elevenchar!", ""]) {
      expect(isVideoId(bad), `accepted bad id: ${JSON.stringify(bad)}`).toBe(false);
    }
    expect(isVideoId("X2oNmdGVBoc")).toBe(true);
    expect(isVideoId("_-aBcDeFgHi")).toBe(true);
  });

  it("classifies_the_failures_users_actually_hit", () => {
    const cases: [string, DownloadFailure][] = [
      ["ERROR: [youtube] abc: Private video. Sign in if you've been granted access", { kind: "Private" }],
      ["ERROR: [youtube] abc: Sign in to confirm your age", { kind: "AgeRestricted" }],
      ["ERROR: [youtube] abc: Video unavailable", { kind: "Unavailable" }],
      ["ERROR: The uploader has not made this video available in your country", { kind: "GeoBlocked" }],
    ];
    for (const [stderr, expected] of cases) {
      expect(classify(stderr), `misread: ${stderr}`).toEqual(expected);
    }
  });

  it("the_real_403_is_treated_as_retryable", () => {
    const observed = "ERROR: unable to download video data: HTTP Error 403: Forbidden";
    const err = classify(observed);
    expect(isRetryable(err), "403 must advance to the next client").toBe(true);
    expect(err.kind).toBe("Transient");

    const reload = "ERROR: [youtube] X2oNmdGVBoc: The page needs to be reloaded.";
    expect(isRetryable(classify(reload))).toBe(true);
  });

  it("definitive_failures_are_not_retried", () => {
    for (const stderr of ["ERROR: Private video", "ERROR: Video unavailable", "ERROR: Sign in to confirm your age"]) {
      expect(isRetryable(classify(stderr)), `would waste four more attempts on: ${stderr}`).toBe(false);
    }
  });

  it("every_error_produces_an_actionable_sentence", () => {
    const errors: DownloadFailure[] = [
      { kind: "Private" },
      { kind: "AgeRestricted" },
      { kind: "GeoBlocked" },
      { kind: "Unavailable" },
      { kind: "ToolMissing" },
      { kind: "Transient", detail: "403" },
      { kind: "Other", detail: "odd" },
      { kind: "InvalidUrl", detail: "nope" },
    ];
    for (const err of errors) {
      const message = userMessage(err);
      expect(message.length, `too terse: ${message}`).toBeGreaterThan(20);
      // A user-facing message should not be a stack trace fragment.
      expect(message, `leaked raw stderr: ${message}`).not.toContain("ERROR:");
    }
  });

  it("canonical_url_is_rebuilt_not_echoed", () => {
    const id = parseVideoId("https://youtu.be/X2oNmdGVBoc?t=42&si=tracking");
    // Tracking params and the original host are gone.
    expect(canonicalUrl(id)).toBe("https://www.youtube.com/watch?v=X2oNmdGVBoc");
  });
});

// Additions beyond the Rust suite: exact strings and argv that were previously
// only exercised by running yt-dlp.
describe("youtube (port additions)", () => {
  it("exact user messages match the Rust literals", () => {
    expect(userMessage("Private")).toBe(
      "This video is private. Ask the owner to make it unlisted or public, or use a different video.",
    );
    expect(userMessage({ kind: "Transient", detail: "HTTP Error 403" })).toBe(
      "YouTube refused the download after trying every available method. This is usually temporary -- wait a minute and retry. (HTTP Error 403)",
    );
    expect(userMessage({ kind: "InvalidUrl", detail: "The link is empty." })).toBe(
      "That does not look like a YouTube link. The link is empty.",
    );
  });

  it("InvalidUrl reasons match the Rust branches", () => {
    expect(invalidUrlError("").detail).toBe("The link is empty.");
    expect(invalidUrlError("ftp://youtube.com/watch?v=X2oNmdGVBoc").detail).toBe("Only http and https links are supported.");
    expect(invalidUrlError("https://www.youtube.com@evil.test/watch?v=X2oNmdGVBoc").detail).toBe(
      "Links with embedded credentials are not accepted.",
    );
    expect(invalidUrlError("https://EVIL.test/watch?v=X2oNmdGVBoc").detail).toBe("`evil.test` is not a YouTube address.");
    expect(invalidUrlError("https://youtube.com/watch?v=short").detail).toBe("No video id found in that link.");
  });

  it("accepts music. host, /v/ path, a port, and a fragment after the id", () => {
    expect(parseVideoId("https://music.youtube.com/watch?v=X2oNmdGVBoc")).toBe("X2oNmdGVBoc");
    expect(parseVideoId("https://www.youtube.com/v/X2oNmdGVBoc")).toBe("X2oNmdGVBoc");
    expect(parseVideoId("https://www.youtube.com:443/watch?v=X2oNmdGVBoc")).toBe("X2oNmdGVBoc");
    expect(parseVideoId("https://youtu.be/X2oNmdGVBoc#t=5")).toBe("X2oNmdGVBoc");
    expect(parseVideoId("https://www.youtube.com/watch?v=X2oNmdGVBoc#top")).toBe("X2oNmdGVBoc");
  });

  it("YoutubeDownloadError carries kind and retrySafe like DownloadError", () => {
    const transient = new YoutubeDownloadError(classify("ERROR: HTTP Error 429: Too Many Requests"));
    expect(transient.kind).toBe("Transient");
    expect(transient.retrySafe).toBe(true);
    expect(transient.message).toContain("HTTP Error 429");
    const priv = new YoutubeDownloadError({ kind: "Private" });
    expect(priv.retrySafe).toBe(false);
  });

  it("firstMeaningfulLine skips warnings and blank lines, capping at 200 chars", () => {
    expect(firstMeaningfulLine("WARNING: a\nERROR: real one\n\nWARNING: b\n")).toBe("ERROR: real one");
    expect(firstMeaningfulLine("")).toBe("no detail");
    expect(firstMeaningfulLine("WARNING: only")).toBe("no detail");
    expect(firstMeaningfulLine("x".repeat(300))).toHaveLength(200);
    expect(classify("nothing recognisable")).toEqual({ kind: "Other", detail: "nothing recognisable" });
  });

  it("player clients are tried in the observed-reliability order", () => {
    expect(PLAYER_CLIENTS).toEqual(["web_embedded", "ios", "mweb", "android", "tv"]);
    expect(playerClientArgv("ios", ["--dump-json"])).toEqual(["--extractor-args", "youtube:player_client=ios", "--dump-json"]);
    const attempts = ytdlpAttempts(["--", "u"]);
    expect(attempts).toHaveLength(5);
    expect(attempts[0]).toEqual(["--extractor-args", "youtube:player_client=web_embedded", "--", "u"]);
  });

  it("probe and download argv match the Rust invocations", () => {
    const id = parseVideoId("X2oNmdGVBoc");
    expect(probeArgv(id)).toEqual(["--dump-json", "--no-warnings", "--skip-download", "--", "https://www.youtube.com/watch?v=X2oNmdGVBoc"]);
    expect(downloadArgv(id, "/tmp/dl")).toEqual([
      "--format",
      YTDLP_FORMAT,
      "--merge-output-format",
      "mp4",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--no-warnings",
      "-o",
      "/tmp/dl/AutoShorts_%(id)s.%(ext)s",
      "--print",
      "after_move:filepath",
      "--no-simulate",
      "--",
      "https://www.youtube.com/watch?v=X2oNmdGVBoc",
    ]);
    expect(YTDLP_FORMAT).toBe("bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best");
  });

  it("reuseAllowed is the Creative Commons check", () => {
    expect(reuseAllowed("Creative Commons Attribution license (reuse allowed)")).toBe(true);
    expect(reuseAllowed("creative commons")).toBe(true);
    expect(reuseAllowed("Standard YouTube License")).toBe(false);
    expect(reuseAllowed(null)).toBe(false);
    expect(reuseAllowed(undefined)).toBe(false);
  });

  it("parseVideoMeta applies the Rust defaults", () => {
    const meta = parseVideoMeta('{"title":"T","uploader":"U","duration":12.5,"license":"Creative Commons Attribution license (reuse allowed)"}\n');
    expect(meta).toEqual({ title: "T", uploader: "U", duration: 12.5, license: "Creative Commons Attribution license (reuse allowed)", reuseAllowed: true });
    expect(parseVideoMeta("{}")).toEqual({ title: "Untitled", uploader: "", duration: 0, license: null, reuseAllowed: false });
    expect(() => parseVideoMeta("not json")).toThrow(YoutubeDownloadError);
    try {
      parseVideoMeta("not json");
    } catch (e) {
      expect((e as YoutubeDownloadError).kind).toBe("Other");
      expect((e as YoutubeDownloadError).detail).toMatch(/^could not read video metadata: /);
    }
  });

  it("parseDownloadOutput takes the last non-empty line", () => {
    expect(parseDownloadOutput("[download] 100%\n/tmp/dl/AutoShorts_X2oNmdGVBoc.mp4 \n\n")).toBe("/tmp/dl/AutoShorts_X2oNmdGVBoc.mp4");
    expect(parseDownloadOutput("\n  \n")).toBeNull();
    expect(parseDownloadOutput("")).toBeNull();
  });
});
