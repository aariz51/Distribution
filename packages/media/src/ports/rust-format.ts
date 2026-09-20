/** Rust `format!("{:.N}", f64)` for the few places the ported code formats
 *  floats into argv or log strings.
 *
 *  Rust rounds an exact decimal tie half-to-even (`{:.0}` of 2.5 is "2");
 *  `Number.prototype.toFixed` rounds the same tie half-up ("3"). An exact tie
 *  at N digits is only possible when `x * 2^(N+1)` is an odd integer, which is
 *  cheap to detect, so the divergence is corrected there and `toFixed` is used
 *  everywhere else. */
export function rustFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return x.toFixed(digits);
  const scaledByTwo = x * 2 ** (digits + 1);
  if (Number.isInteger(scaledByTwo) && Math.abs(scaledByTwo) % 2 === 1) {
    const scaled = x * 10 ** digits; // exact half-integer
    const lo = Math.floor(scaled);
    const n = lo % 2 === 0 ? lo : lo + 1;
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (digits === 0) return `${sign}${abs}`;
    const base = 10 ** digits;
    return `${sign}${Math.trunc(abs / base)}.${String(abs % base).padStart(digits, "0")}`;
  }
  return x.toFixed(digits);
}

/** Rust `f64 as u32`: truncates toward zero, saturates, NaN becomes 0. */
export function asU32(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 4294967295) return 4294967295;
  return Math.trunc(x);
}

/** Rust `f64::round() as i64`: half away from zero, then saturating cast. */
export function roundAsI64(x: number): number {
  if (Number.isNaN(x)) return 0;
  const r = Math.sign(x) * Math.round(Math.abs(x));
  const MAX = 9223372036854775807;
  if (r >= MAX) return MAX;
  if (r <= -MAX - 1) return -MAX - 1;
  return r === 0 ? 0 : r;
}
