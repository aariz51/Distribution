import React from "react";
import { Img, staticFile } from "remotion";
import { alpha, useTheme } from "../theme";

// A clean rounded iPhone with a real app screenshot inside, dynamic island,
// and an optional brand glow. Width-driven; height derives from theme.screenRatio.
//
// FAIL LOUD: a missing screenshot throws (via <Img onError>), which cancels the
// render with a clear message. A headless job must never ship a film with a
// striped "missing screen" placeholder inside a phone.
export const PhoneFrame: React.FC<{
  src: string;
  width: number;
  glow?: string;
  radius?: number;
  bezel?: number;
  shadow?: boolean;
}> = ({ src, width, glow, radius, bezel, shadow = true }) => {
  const theme = useTheme();
  const c = theme.colors;
  const b = bezel ?? Math.max(8, width * 0.03);
  const r = radius ?? width * 0.14;
  const screenW = width - b * 2;
  const screenH = screenW / theme.screenRatio;
  const height = screenH + b * 2;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: r,
        background: "linear-gradient(160deg, #2A2C3A 0%, #14151E 100%)",
        padding: b,
        boxSizing: "border-box",
        position: "relative",
        boxShadow: shadow ? `0 50px 110px ${alpha(c.ink, 0.34)}${glow ? `, 0 0 90px ${glow}` : ""}` : glow ? `0 0 90px ${glow}` : undefined,
      }}
    >
      <div style={{ width: screenW, height: screenH, borderRadius: r - b, overflow: "hidden", position: "relative", background: c.cream }}>
        <Img
          src={staticFile(src)}
          onError={() => {
            throw new Error(`[PhoneFrame] screen "${src}" failed to load — check public/${src} exists and storyboard.screens points at it.`);
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
        />
      </div>
      <div style={{ position: "absolute", top: b + screenH * 0.018, left: "50%", transform: "translateX(-50%)", width: screenW * 0.3, height: screenW * 0.085, borderRadius: 100, background: "#0B0C12" }} />
    </div>
  );
};
