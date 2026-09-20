import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "../theme";
import { seed } from "../animations/motion";

// Ambient soft-focus particles drifting upward. Deterministic, low-opacity.
export const Particles: React.FC<{ count?: number; opacity?: number }> = ({ count = 22, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const c = useTheme().colors;

  const dots = new Array(count).fill(0).map((_, i) => {
    const r = seed(i);
    const r2 = seed(i + 99);
    const r3 = seed(i + 200);
    const size = 6 + r * 26;
    const speed = 0.15 + r2 * 0.5;
    const amp = 20 + r3 * 60;
    const baseX = r * width;
    const x = baseX + Math.sin(frame / (60 + r2 * 80) + i) * amp;
    const yStart = r2 * height;
    const y = ((yStart - frame * speed) % height + height) % height;
    const col = i % 3 === 0 ? c.gold : i % 3 === 1 ? c.accent : c.primarySoft;
    const tw = 0.12 + 0.14 * (0.5 + 0.5 * Math.sin(frame / 30 + i));
    return { x, y, size, col, op: tw };
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {dots.map((d, i) => (
        <div key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.size, height: d.size, marginLeft: -d.size / 2, marginTop: -d.size / 2, borderRadius: "50%", background: d.col, opacity: d.op * opacity, filter: "blur(6px)" }} />
      ))}
    </AbsoluteFill>
  );
};
