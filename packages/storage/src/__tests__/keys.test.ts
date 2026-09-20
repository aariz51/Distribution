import { describe, expect, it } from "vitest";
import { assertValidKey, keys } from "../keys";

describe("storage keys", () => {
  it("accepts generated keys", () => {
    expect(() => assertValidKey(keys.clip("p1", "c1", "flat"))).not.toThrow();
    expect(() => assertValidKey(keys.brandAsset("p", "a", "png"))).not.toThrow();
  });
  it("rejects traversal and unknown prefixes", () => {
    expect(() => assertValidKey("products/../etc/passwd")).toThrow();
    expect(() => assertValidKey("/etc/passwd")).toThrow();
    expect(() => assertValidKey("products//x")).toThrow();
    expect(() => assertValidKey("secrets/key")).toThrow();
    expect(() => assertValidKey("products/a b/c")).toThrow();
  });
});
