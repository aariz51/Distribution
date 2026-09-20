import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { fontHead, useTheme } from "../theme";
import { sEnter } from "../animations/springs";

export type Word = { text: string; color?: string };

// Word-by-word spring reveal with per-word keyword colouring.
export const KineticWords: React.FC<{
  words: Word[];
  fontSize?: number;
  weight?: number;
  startAt?: number;
  stagger?: number;
  lineHeight?: number;
  gap?: number;
  maxWidth?: number | string;
  letterSpacing?: number;
  color?: string;
}> = ({ words, fontSize = 96, weight = 700, startAt = 0, stagger = 6, lineHeight = 1.1, gap = 0.28, maxWidth = "78%", letterSpacing = -1, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: `${gap * 0.4}em ${gap}em`,
        maxWidth,
        margin: "0 auto",
        fontFamily: fontHead(theme),
        fontWeight: weight,
        fontSize,
        lineHeight,
        letterSpacing,
        textAlign: "center",
      }}
    >
      {words.map((w, i) => {
        const s = sEnter({ frame, fps, delay: startAt + i * stagger });
        const y = interpolate(s, [0, 1], [46, 0]);
        const op = interpolate(s, [0, 1], [0, 1]);
        const sc = interpolate(s, [0, 1], [0.82, 1]);
        return (
          <span key={i} style={{ display: "inline-block", color: w.color ?? color ?? theme.colors.ink, opacity: op, transform: `translateY(${y}px) scale(${sc})` }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
};
