import { describe, expect, it } from "vitest";
import { estimateChatUsd, imageTokenCeiling, reserveChatUsd } from "../pricing";

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe("promo model pricing", () => {
  it("prices Opus 5.5 at its own OpenRouter rate, not Opus 5's", () => {
    expect(estimateChatUsd("anthropic/claude-opus-5.5", 1_000_000, 0).usd).toBeCloseTo(4);
    expect(estimateChatUsd("anthropic/claude-opus-5.5", 0, 1_000_000).usd).toBeCloseTo(20);
    expect(estimateChatUsd("anthropic/claude-opus-5", 1_000_000, 0).usd).toBeCloseTo(5);
  });

  it("estimates an image by its resized pixel count, not its byte size", () => {
    expect(imageTokenCeiling(png(1440, 1080))).toBeLessThanOrEqual(1650);
    expect(imageTokenCeiling(png(400, 300))).toBeLessThan(300);
    expect(imageTokenCeiling(Buffer.from("not an image"))).toBe(3300);
  });

  it("keeps a three-sheet reference reading well under the $0.50 promo cap", () => {
    const req = { maxTokens: 3000, messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "x".repeat(4000) }, ...[1, 2, 3].map(() => ({ type: "image" as const, mimeType: "image/png", data: png(1440, 1080) }))] }] };
    const usd = reserveChatUsd("anthropic/claude-opus-5.5", req, 3000, 1);
    expect(usd).toBeLessThan(0.1);
  });
});
