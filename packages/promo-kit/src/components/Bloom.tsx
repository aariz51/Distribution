import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { alpha, useTheme } from "../theme";

// White radial light-bloom that blows out then recovers — the signature
// section-stitch transition. Drive `frame` relative to the bloom's local start.
export const Bloom: React.FC<{
  frame: number;
  peak?: number;
  rise?: number;
  fall?: number;
  color?: string;
}> = ({ frame, peak = 8, rise = 8, fall = 14, color }) => {
  const theme = useTheme();
  const col = color ?? theme.colors.white;
  const op = interpolate(frame, [peak - rise, peak, peak + fall], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (op <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 50%, ${col} 0%, ${col} 40%, ${alpha(col, 0)} 75%)`,
        opacity: op,
        pointerEvents: "none",
      }}
    />
  );
};
