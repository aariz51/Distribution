import React from "react";
import { alpha, useTheme } from "../theme";

// Glassmorphic floating prop — semi-transparent brand gradient, ambient shadow, soft inner highlight.
export const GlassCard: React.FC<{
  width: number;
  height: number;
  tint?: string;
  radius?: number;
  glow?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, tint, radius = 34, glow, children, style }) => {
  const c = useTheme().colors;
  const t = tint ?? c.primary;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        position: "relative",
        background: `linear-gradient(155deg, ${alpha(t, 0.9)} 0%, ${alpha(t, 0.7)} 55%, ${alpha(t, 0.5)} 100%)`,
        boxShadow: `0 40px 90px ${alpha(t, 0.25)}, 0 8px 30px ${alpha(c.ink, 0.12)}${glow ? `, 0 0 80px ${glow}` : ""}`,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: `linear-gradient(180deg, ${alpha(c.white, 0.35)} 0%, ${alpha(c.white, 0)} 30%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, border: `1.5px solid ${alpha(c.white, 0.35)}`, pointerEvents: "none" }} />
      {children}
    </div>
  );
};
