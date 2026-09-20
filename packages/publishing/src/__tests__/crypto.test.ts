import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../crypto";

describe("crypto", () => {
  it("round-trips and uses a fresh iv each time", () => {
    const a = encryptSecret("pk_live_abc", "s3cret");
    const b = encryptSecret("pk_live_abc", "s3cret");
    expect(a).not.toBe(b);
    expect(a.split(".")).toHaveLength(3);
    expect(decryptSecret(a, "s3cret")).toBe("pk_live_abc");
    expect(decryptSecret(b, "s3cret")).toBe("pk_live_abc");
  });
  it("rejects the wrong key and tampering", () => {
    const enc = encryptSecret("hello", "right");
    expect(() => decryptSecret(enc, "wrong")).toThrow();
    const [iv, tag, ct] = enc.split(".") as [string, string, string];
    const flipped = Buffer.from(ct, "base64");
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."), "right")).toThrow();
    expect(() => decryptSecret("nope", "right")).toThrow(/malformed/);
  });
});
