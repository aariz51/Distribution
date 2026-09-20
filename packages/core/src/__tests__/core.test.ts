import { describe, expect, it } from "vitest";
import { ASSET_TRANSITIONS, canTransition, type AssetStatus } from "../statuses";
import { productContextBlock } from "../schemas/product";
import { redact } from "../logger";
import { PipelineError, isRetrySafe } from "../errors";
import { slugify } from "../ids";

describe("asset state machine", () => {
  it("allows the happy path end to end", () => {
    const path: AssetStatus[] = ["draft", "processing", "review", "approved", "scheduled", "publishing", "published", "archived"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it("refuses to skip review or resurrect an archived asset", () => {
    expect(canTransition("processing", "published")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("archived", "review")).toBe(false);
    expect(ASSET_TRANSITIONS.archived).toEqual([]);
  });

  it("lets a failed asset be retried or archived, and nothing else", () => {
    expect(canTransition("failed", "processing")).toBe(true);
    expect(canTransition("failed", "publishing")).toBe(true);
    expect(canTransition("failed", "published")).toBe(false);
  });
});

describe("productContextBlock", () => {
  const profile = {
    product: {
      name: "Civia",
      tagline: "Pass the US civics test",
      description: "A study app.",
      category: { primary: "education", tags: ["test-prep"] },
      features: [
        { id: "1", title: "Mock test", priority: 2, evidenceAssetIds: [] },
        { id: "2", title: "Every question", detail: "All 128", priority: 1, evidenceAssetIds: [] },
      ],
      competitors: [{ name: "Rival" }],
      audience: { summary: "Applicants", segments: [], painPoints: ["Too many sources"] },
      platforms: ["ios" as const],
      urls: {},
    },
  };

  it("lists features in the founder's priority order, not array order", () => {
    const block = productContextBlock(profile);
    expect(block.indexOf("Every question")).toBeLessThan(block.indexOf("Mock test"));
    expect(block).toContain("1. Every question — All 128");
  });

  it("includes the facts a prompt needs and omits empty sections", () => {
    const block = productContextBlock(profile);
    expect(block).toContain("PRODUCT: Civia — Pass the US civics test");
    expect(block).toContain("COMPETITORS: Rival");
    expect(block).toContain("pain points: Too many sources");
    const bare = productContextBlock({ product: { ...profile.product, competitors: [], audience: { summary: "x", segments: [], painPoints: [] }, description: undefined } });
    expect(bare).not.toContain("COMPETITORS");
    expect(bare).not.toContain("DESCRIPTION");
  });
});

describe("redact", () => {
  it("removes every credential shape that reaches a log or the UI", () => {
    expect(redact("key sk-ant-api03-abcdefghijklmnop failed")).not.toContain("abcdefghij");
    expect(redact("Authorization: Bearer abcdef1234567890")).toContain("[redacted]");
    expect(redact("https://x.test/v1?key=AIzaSyA1234567890abcdefghijklmnop")).not.toContain("AIzaSy");
    expect(redact("pos_abcdefgh1234")).toContain("[redacted]");
    expect(redact("nothing secret here")).toBe("nothing secret here");
  });
});

describe("errors", () => {
  it("carries retry-safety so the queue knows whether to re-run a step", () => {
    expect(isRetrySafe(new PipelineError("rate limited", { retrySafe: true }))).toBe(true);
    expect(isRetrySafe(new PipelineError("bad input"))).toBe(false);
    expect(isRetrySafe(new Error("unknown"))).toBe(false);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs and never an empty one", () => {
    expect(slugify("Civia — Civics Test!")).toBe("civia-civics-test");
    expect(slugify("  ")).toBe("product");
    expect(slugify("Café Niño")).toBe("cafe-nino");
  });
});
