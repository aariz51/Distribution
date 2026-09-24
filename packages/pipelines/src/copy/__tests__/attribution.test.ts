import { describe, expect, it } from "vitest";
import { sourceAttribution } from "../../shorts/attribution";
import { captionLength, composeCaption, fitGeneratedCaption } from "../caption";
const source = { rights: "licensed", title: "Food labels", creator: "Source author", url: "https://www.youtube.com/watch?v=kaozBsvg2_Y", licenseText: "Creative Commons Attribution license (reuse allowed)" };
describe("source credit preservation", () => {
  it("uses actual source identity and marks adaptations, without inventing missing creators", () => {
    const credit = sourceAttribution(source)!;
    for (const part of [source.title, source.creator, source.url, "support.google.com/youtube/answer/2797468", "Edited excerpt"]) expect(credit).toContain(part);
    expect(sourceAttribution({ ...source, licenseText: "CC BY 3.0" })).toContain("creativecommons.org/licenses/by/3.0/");
    expect(() => sourceAttribution({ ...source, creator: "" })).toThrow("title, creator");
    expect(sourceAttribution({ ...source, rights: "owned" })).toBeUndefined();
  });
  it("preserves all credit text when fitting generated X prose and optional extras", () => {
    const credit = sourceAttribution(source)!;
    const fitted = fitGeneratedCaption({ caption: "Useful information. ".repeat(40), cta: "Discover SafeChoice.", hashtags: ["food", "nutrition"] }, 280, credit);
    expect(fitted.caption.endsWith(credit)).toBe(true);
    expect(composeCaption(fitted).length).toBeLessThanOrEqual(280);
    expect(composeCaption(fitted, credit)).toBe(composeCaption(fitted));
  });
  it("restores a removed credit at publication and refuses a credit too long to fit", () => {
    const credit = sourceAttribution(source)!;
    expect(composeCaption({ caption: "Edited by user", cta: "", hashtags: [] }, credit)).toContain(credit);
    expect(() => fitGeneratedCaption({ caption: "Body", cta: "", hashtags: [] }, 50, credit)).toThrow("attribution does not fit");
  });
  it("counts CTA, hashtags and separators even without attribution", () => {
    const fitted = fitGeneratedCaption({ caption: "A".repeat(400), cta: "Try it", hashtags: ["FOOD"] }, 280);
    expect(composeCaption(fitted).length).toBeLessThanOrEqual(280);
    expect(fitted.hashtags).toEqual(["food"]);
  });
});

it("counts X weighted text and URLs when fitting multilingual captions", () => {
  expect(captionLength("食".repeat(141), "x")).toBe(282);
  expect(captionLength("https://example.com/a-very-long-source-url", "x")).toBe(23);
  const fitted = fitGeneratedCaption({ caption: "食".repeat(200), cta: "", hashtags: [] }, 280, undefined, "x");
  expect(captionLength(composeCaption(fitted), "x")).toBeLessThanOrEqual(280);
});
