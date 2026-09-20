import { describe, expect, it } from "vitest";
import { asU32, roundAsI64, rustFixed } from "../rust-format";

describe("rustFixed", () => {
  it("matches toFixed away from exact ties", () => {
    expect(rustFixed(90, 3)).toBe("90.000");
    expect(rustFixed(0.1, 3)).toBe("0.100");
    expect(rustFixed(1.23456, 3)).toBe("1.235");
    expect(rustFixed(60.5, 3)).toBe("60.500");
    expect(rustFixed(87.5, 0)).toBe("88");
    expect(rustFixed(60.00000000000001, 0)).toBe("60");
  });

  it("rounds exact ties half to even like Rust's {:.N}", () => {
    expect(rustFixed(60.0625, 3)).toBe("60.062"); // toFixed gives 60.063
    expect(rustFixed(60.1875, 3)).toBe("60.188");
    expect(rustFixed(2.5, 0)).toBe("2");
    expect(rustFixed(3.5, 0)).toBe("4");
    expect(rustFixed(12.5, 0)).toBe("12");
    expect(rustFixed(-2.5, 0)).toBe("-2");
    expect(rustFixed(0.5, 0)).toBe("0");
  });
});

describe("casts", () => {
  it("asU32 truncates and saturates", () => {
    expect(asU32(7.9)).toBe(7);
    expect(asU32(-1)).toBe(0);
    expect(asU32(Number.NaN)).toBe(0);
    expect(asU32(1e12)).toBe(4294967295);
  });
  it("roundAsI64 rounds half away from zero", () => {
    expect(roundAsI64(2.5)).toBe(3);
    expect(roundAsI64(-2.5)).toBe(-3);
    expect(roundAsI64(-0.4)).toBe(0);
    expect(Object.is(roundAsI64(-0.4), 0)).toBe(true);
    expect(roundAsI64(Number.NaN)).toBe(0);
  });
});
