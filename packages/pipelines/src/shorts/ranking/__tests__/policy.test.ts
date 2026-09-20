/**
 * Ported one-to-one from `autoshorts/src-tauri/src/openrouter.rs:791-953`
 * (`mod tests`). Test titles are the Rust test names. The `live_tests`
 * module is not ported: it is `#[ignore]`d and spends real API credit.
 */

import { describe, expect, it } from "vitest";
import {
  TASK_DEFAULT_MODELS,
  backoffSecs,
  base64Decode,
  decodeImagePayload,
  extractText,
  isRetryable,
  parseChatResponse,
  parseRetryAfter,
  redact,
  taskModel,
} from "../policy";

const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("redact (openrouter.rs)", () => {
  it("redacts_openrouter_keys_anywhere_in_text", () => {
    const leaked = "401 Unauthorized for Bearer sk-or-v1-abc123def456 on /chat";
    const safe = redact(leaked);
    expect(safe, `key survived: ${safe}`).not.toContain("abc123def456");
    expect(safe).toContain("sk-***REDACTED***");
    // Surrounding context must survive or the log line is useless.
    expect(safe.startsWith("401 Unauthorized for Bearer ")).toBe(true);
    expect(safe.endsWith(" on /chat")).toBe(true);
  });

  it("redacts_every_key_not_just_the_first", () => {
    const two = "sk-or-v1-aaa and also sk-ant-oat01-bbb";
    const safe = redact(two);
    expect(safe).not.toContain("aaa");
    expect(safe).not.toContain("bbb");
    expect(safe.split("REDACTED").length - 1).toBe(2);
  });

  it("redact_leaves_clean_text_untouched", () => {
    const clean = "ffmpeg exited with status 1";
    expect(redact(clean)).toBe(clean);
  });
});

describe("retry policy (openrouter.rs)", () => {
  it("only_transient_failures_are_retried", () => {
    // A malformed request will be just as malformed next time.
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
    // These clear up on their own.
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(502)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(408)).toBe(true);
  });

  it("backoff_grows_and_respects_retry_after", () => {
    expect(backoffSecs(0, null)).toBe(2);
    expect(backoffSecs(1, null)).toBe(4);
    expect(backoffSecs(2, null)).toBe(8);
    // The server's own number wins when it sends one.
    expect(backoffSecs(0, 30)).toBe(30);
    // But a hostile header cannot park the pipeline indefinitely.
    expect(backoffSecs(0, 99999)).toBe(120);
  });

  it("caps the exponential curve at 60 s and parses header strings like Rust u64", () => {
    expect(backoffSecs(4)).toBe(32);
    expect(backoffSecs(5)).toBe(60);
    expect(backoffSecs(40)).toBe(60);
    expect(backoffSecs(0, " 30 ")).toBe(30);
    expect(backoffSecs(0, "Wed, 21 Oct 2015 07:28:00 GMT")).toBe(2);
    expect(parseRetryAfter("+7")).toBe(7);
    expect(parseRetryAfter("-7")).toBeNull();
    expect(parseRetryAfter("1.5")).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });
});

describe("Task tiering (openrouter.rs)", () => {
  it("task_models_are_env_overridable", () => {
    // Asserts the mechanism, not a specific model id: pinning the default
    // string here means every cost/quality retune breaks the test for no
    // reason.
    const def = taskModel("copy", {});
    expect(def).not.toBe("");
    expect(def, `not an OpenRouter model id: ${def}`).toContain("/");

    expect(taskModel("copy", { OPENROUTER_MODEL_COPY: "some/other-model" })).toBe("some/other-model");

    // Blank and whitespace-only overrides must fall back, not produce a
    // request for the empty-string model.
    expect(taskModel("copy", { OPENROUTER_MODEL_COPY: "   " })).toBe(def);
    expect(taskModel("copy", { OPENROUTER_MODEL_COPY: undefined })).toBe(def);
  });

  /** Regression. The copy tier was first pointed at `deepseek-v4-flash`
   *  purely on price. It is a reasoning model: on a six-word headline it
   *  spent all 100 output tokens in the hidden reasoning channel, returned
   *  `content: null`, and still billed for them. */
  it("short_output_tiers_avoid_known_reasoning_models", () => {
    const REASONING = ["deepseek/deepseek-v4-flash", "openai/gpt-5-nano", "qwen/qwen3.7-flash"];
    for (const task of ["copy", "utility"] as const) {
      const model = TASK_DEFAULT_MODELS[task];
      expect(
        REASONING,
        `${task} defaults to reasoning model ${model}, which returns empty content on small max_tokens budgets`,
      ).not.toContain(model);
    }
  });
});

describe("extract_text (openrouter.rs)", () => {
  /** The diagnostic that turns "no text content" into something actionable. */
  it("empty_reasoning_response_is_reported_as_such", () => {
    const body = {
      choices: [
        {
          message: { role: "assistant", content: null, reasoning: "thinking out loud..." },
          finish_reason: "length",
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 100,
        cost: 0.0000147,
        completion_tokens_details: { reasoning_tokens: 99 },
      },
    };
    const parsed = parseChatResponse(body);
    let err = "";
    try {
      extractText(parsed, "vendor/thinky");
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err, `unhelpful error: ${err}`).toContain("reasoning model");
    expect(err, `token count missing: ${err}`).toContain("99");
  });

  it("normal_responses_extract_cleanly", () => {
    const body = {
      choices: [{ message: { role: "assistant", content: "  Ripe papaya is safe.  " }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 6, cost: 0.000006 },
    };
    const parsed = parseChatResponse(body);
    expect(extractText(parsed, "m")).toBe("Ripe papaya is safe.");
  });

  it("distinguishes no-choices, length-limit and plain-empty replies", () => {
    expect(() => extractText(parseChatResponse({}), "m")).toThrow("m returned no choices");
    expect(() =>
      extractText(parseChatResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), "m"),
    ).toThrow(/hit the output token limit/);
    expect(() => extractText(parseChatResponse({ choices: [{ message: { content: null } }] }), "m")).toThrow(
      "m returned an empty response (finish_reason: unknown)",
    );
  });
});

describe("image payloads (openrouter.rs)", () => {
  it("base64_round_trips_known_vector", () => {
    // "Hello, World!" -- checks padding handling on a non-multiple-of-3 input.
    expect(utf8(base64Decode("SGVsbG8sIFdvcmxkIQ=="))).toBe("Hello, World!");
  });

  it("base64_tolerates_embedded_newlines", () => {
    expect(utf8(base64Decode("SGVs\nbG8s\nIFdv\ncmxkIQ=="))).toBe("Hello, World!");
  });

  it("data_uri_images_decode", () => {
    const uri = "data:image/png;base64,SGVsbG8sIFdvcmxkIQ==";
    expect(utf8(decodeImagePayload(uri))).toBe("Hello, World!");
  });

  /** A model picks this string. Handing `file:///etc/passwd` to a fetcher
   *  because a model asked nicely is the whole SSRF class in one line. */
  it("non_https_image_urls_are_refused", () => {
    for (const hostile of ["file:///etc/passwd", "http://169.254.169.254/latest/meta-data/", "gopher://internal:70/"]) {
      let err = "";
      try {
        decodeImagePayload(hostile);
      } catch (e) {
        err = (e as Error).message;
      }
      expect(err, `${hostile} was not refused: ${err}`).toContain("non-HTTPS");
    }
  });

  it("rejects invalid base64 and non-base64 data URIs", () => {
    expect(() => base64Decode("SGVs*bG8=")).toThrow("invalid base64 in image payload");
    expect(() => decodeImagePayload("data:image/png,rawbytes")).toThrow("image data URI was not base64");
    expect(() => decodeImagePayload("https://example.com/a.png")).toThrow(/remote image URL/);
  });
});
