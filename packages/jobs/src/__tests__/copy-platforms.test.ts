import { describe, expect, it } from "vitest";
import { JOB_TYPES } from "../registry";

describe("copy job platform contract", () => {
  const payload = { productId: "6cc41ef3-7761-4520-b843-361ce1b8bca7", assetId: "d8f46b75-df42-49c7-9eab-2b89002cb02c" };
  it("rejects a connected channel ID before a paid copy request can be queued", () => {
    expect(JOB_TYPES["copy.generate"].payload.safeParse({ ...payload, platforms: ["cmu5oan7n05zfmc0yxlllsgi6"] }).success).toBe(false);
  });
  it("accepts platform names and rejects provider integration aliases", () => {
    expect(JOB_TYPES["copy.generate"].payload.safeParse({ ...payload, platforms: ["instagram", "youtube"] }).success).toBe(true);
    expect(JOB_TYPES["copy.generate"].payload.safeParse({ ...payload, platforms: ["instagram-standalone"] }).success).toBe(false);
  });
});
