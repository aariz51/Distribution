// ════════════════════════════════════════════════════════════════════════════
//  SHOWREEL DEVICES — high-energy scene kinds for short, motion-led films.
//
//  Same contract as the rest of the kit: pure functions of (scene, storyboard,
//  theme), copy from `scene.copy`, screens from `scene.screens`. Two motion
//  layers, as docs/scene-kit.md prescribes:
//    cinematic  → springs / easings / interpolate (cameras, 3D, slams)
//    UI + type  → Cube Motion through animations/cube.tsx (labels, counters,
//                 lists, text that changes state). Never cube-motion directly.
// ════════════════════════════════════════════════════════════════════════════
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, Storyboard } from "../schema";
import { alpha, bgDark, bgRadial, fontHead, fontMono, useTheme } from "../theme";
import { EASE } from "../animations/easings";
import { bob, seed } from "../animations/motion";
import { sPop, sSettle } from "../animations/springs";
import { CubeList, CubeMorphSequence, CubeRise } from "../animations/cube";
import { Particles } from "../components/Particles";
import { PhoneFrame } from "../components/PhoneFrame";
import { useTailFade } from "./tail";

export interface ShowreelProps {
  scene: Scene;
  storyboard: Storyboard;
}

const c = (s: Scene, key: string, fallback = ""): string => s.copy[key] ?? fallback;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function screenKeys(scene: Scene, sb: Storyboard, min: number): string[] {
  const keys = scene.screens?.length ? scene.screens : Object.keys(sb.screens);
  if (keys.length === 0) throw new Error(`scene ${scene.id} (${scene.kind}) needs at least one screen`);
  const out = [...keys];
  while (out.length < min) out.push(keys[out.length % keys.length]!);
  return out;
}

function src(sb: Storyboard, key: string): string {
  const p = sb.screens[key];
  if (!p) throw new Error(`storyboard references screen "${key}" which is not in storyboard.screens`);
  return p;
}

// ── kinetic ─────────────────────────────────────────────────────────────────
// Type slams on the beat. Each word crashes in from scale and blur; the ground
// flips colour with it; the previous word lingers behind as an outline so the
// sequence reads as one gesture. A Cube-morphed counter ticks the beats.
const Kinetic: React.FC<ShowreelProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.primary;
  const wide = width > height;
  const words = ["w1", "w2", "w3", "w4", "w5"].map((k) => c(scene, k)).filter(Boolean);
  const list = words.length ? words : ["Make", "it", "move."];
  const span = Math.max(8, Math.floor(scene.duration / list.length));
  const idx = Math.min(list.length - 1, Math.floor(frame / span));
  const local = frame - idx * span;
  const opacity = useTailFade(frame, scene.duration, 8);

  // Grounds cycle ink → accent → cream so every beat is a cut, not a fade.
  const grounds = [theme.colors.ink, accent, theme.colors.cream];
  const inks = [theme.colors.white, theme.colors.white, theme.colors.ink];
  const g = (scene.options?.startGround as number | undefined) ?? 0;
  const ground = grounds[(idx + g) % grounds.length]!;
  const ink = inks[(idx + g) % inks.length]!;

  const slam = spring({ frame: local, fps, config: { damping: 13, stiffness: 260, mass: 0.7 } });
  const scale = interpolate(slam, [0, 1], [2.6, 1]);
  const blur = interpolate(local, [0, 7], [18, 0], clamp);
  const shake = local < 6 ? Math.sin(local * 2.7) * (6 - local) * 1.4 : 0;
  const word = list[idx]!;
  const size = Math.min((wide ? height * 0.34 : width * 0.3) * (6 / Math.max(6, word.length)), wide ? height * 0.3 : width * 0.26) * (word.length <= 4 ? 1.25 : 1);
  const prev = idx > 0 ? list[idx - 1]! : null;
  const ghostScale = interpolate(local, [0, span], [1.05, 1.9], clamp);
  const ghostOpacity = interpolate(local, [0, span * 0.8], [0.5, 0], clamp);

  const counterLabels = list.map((_, i) => `${String(i + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}`);
  const counterAt = list.slice(1).map((_, i) => (i + 1) * span);

  return (
    <AbsoluteFill style={{ background: ground, opacity }}>
      {prev && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              fontFamily: fontHead(theme),
              fontWeight: 800,
              fontSize: size,
              letterSpacing: -size * 0.04,
              color: "transparent",
              WebkitTextStroke: `${Math.max(2, size * 0.012)}px ${alpha(ink, 0.55)}`,
              transform: `scale(${ghostScale})`,
              opacity: ghostOpacity,
              whiteSpace: "nowrap",
            }}
          >
            {prev}
          </div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: fontHead(theme),
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1,
            letterSpacing: -size * 0.04,
            color: ink,
            transform: `translate(${shake}px, ${-shake * 0.6}px) scale(${scale})`,
            filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          {word}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: "7%", bottom: wide ? "9%" : "7%", fontFamily: fontMono(theme), fontSize: wide ? height * 0.024 : width * 0.03, letterSpacing: 4, color: alpha(ink, 0.7) }}>
        {counterAt.length ? <CubeMorphSequence labels={counterLabels} at={counterAt} /> : counterLabels[0]}
      </div>
      {c(scene, "caption") && (
        <div style={{ position: "absolute", right: "7%", bottom: wide ? "9%" : "7%", fontFamily: fontMono(theme), fontSize: wide ? height * 0.024 : width * 0.03, letterSpacing: 4, color: alpha(ink, 0.7), textTransform: "uppercase" }}>
          <CubeRise at={4}>{c(scene, "caption")}</CubeRise>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── cube ────────────────────────────────────────────────────────────────────
// A real 3D prism of the product's screens, snapping face to face on the beat
// with an overshooting spring. Each face is a feature; its name morphs in
// beneath as the face lands.
const ScreenCube: React.FC<ShowreelProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.primary;
  const wide = width > height;
  const keys = screenKeys(scene, storyboard, 4).slice(0, 4);
  const labels = ["f1", "f2", "f3", "f4"].map((k, i) => c(scene, k, `Feature ${i + 1}`)).slice(0, keys.length);
  const opacity = useTailFade(frame, scene.duration, 10);

  const faceH = wide ? height * 0.62 : height * 0.46;
  const faceW = faceH * 0.5;
  const depth = faceW / 2;
  const enter = sSettle({ frame, fps, delay: 0 });
  const hold = Math.max(10, Math.floor((scene.duration - 10) / keys.length));
  // Rotation: one quarter turn per face, each a sprung snap starting on its beat.
  let rot = 0;
  for (let i = 1; i < keys.length; i++) {
    const s = spring({ frame: frame - i * hold, fps, config: { damping: 11, stiffness: 170, mass: 0.8 } });
    rot -= 90 * s;
  }
  const wobble = Math.sin(frame / 22) * 6;
  const tiltX = interpolate(enter, [0, 1], [-38, -10]);
  const at = keys.slice(1).map((_, i) => (i + 1) * hold + 4);
  // The label morphs on one line, so size it to the longest feature name.
  const longest = Math.max(...labels.map((l) => l.length), 1);
  const labelSize = Math.min(wide ? height * 0.075 : width * 0.085, (wide ? width * 0.36 : width * 0.88) / (longest * 0.54));

  return (
    <AbsoluteFill style={{ background: bgDark(theme), opacity }}>
      <Particles count={26} opacity={0.5} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: wide ? "row" : "column", gap: wide ? width * 0.07 : height * 0.05 }}>
        <div style={{ perspective: faceH * 3.2, width: faceW, height: faceH, transform: `scale(${0.6 + enter * 0.4})` }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              transformStyle: "preserve-3d",
              transform: `translateZ(${-depth}px) rotateX(${tiltX}deg) rotateY(${rot + wobble}deg)`,
            }}
          >
            {keys.map((k, i) => (
              <div
                key={`${k}-${i}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `rotateY(${i * 90}deg) translateZ(${depth}px)`,
                  backfaceVisibility: "hidden",
                  borderRadius: faceW * 0.12,
                  overflow: "hidden",
                  boxShadow: `0 0 0 ${Math.max(2, faceW * 0.012)}px ${alpha(theme.colors.white, 0.18)}, 0 ${faceH * 0.05}px ${faceH * 0.12}px ${alpha("#000000", 0.45)}`,
                  background: theme.colors.ink,
                }}
              >
                <Img src={staticFile(src(storyboard, k))} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, ${alpha(theme.colors.white, 0.18)} 0%, transparent 35%, transparent 70%, ${alpha("#000000", 0.25)} 100%)` }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: wide ? "flex-start" : "center", gap: height * 0.015, maxWidth: wide ? width * 0.36 : width * 0.84 }}>
          {c(scene, "eyebrow") && (
            <CubeRise at={6} style={{ fontFamily: fontMono(theme), fontSize: wide ? height * 0.024 : width * 0.03, letterSpacing: 5, color: accent, textTransform: "uppercase" }}>
              {c(scene, "eyebrow")}
            </CubeRise>
          )}
          <div style={{ fontFamily: fontHead(theme), fontWeight: 800, fontSize: labelSize, lineHeight: 1.05, color: theme.colors.white, textAlign: wide ? "left" : "center" }}>
            {at.length ? <CubeMorphSequence labels={labels} at={at} /> : labels[0]}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {keys.map((_, i) => {
              const active = frame >= (i === 0 ? 0 : at[i - 1]! - 4) && (i === keys.length - 1 || frame < at[i]! - 4);
              return <div key={i} style={{ width: active ? 38 : 12, height: 12, borderRadius: 6, background: active ? accent : alpha(theme.colors.white, 0.3) }} />;
            })}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── wall ────────────────────────────────────────────────────────────────────
// An isometric wall of screens rises tile by tile while the camera tracks across
// it; then the hero tile lifts out of the plane and the camera dives into it.
const Wall: React.FC<ShowreelProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.primary;
  const wide = width > height;
  const cols = wide ? 5 : 3;
  const rows = wide ? 3 : 4;
  const keys = screenKeys(scene, storyboard, cols * rows);
  const hero = Math.floor((rows * cols) / 2);
  const tileW = wide ? width * 0.13 : width * 0.25;
  const tileH = tileW * 2.05;
  const gap = tileW * 0.18;
  const DIVE = Math.round(scene.duration * 0.62);

  const track = interpolate(frame, [0, DIVE], [tileW * 0.6, -tileW * 0.2], { ...clamp, easing: EASE.inOut });
  const dive = interpolate(frame, [DIVE, scene.duration], [0, 1], { ...clamp, easing: EASE.in });
  const camRX = interpolate(dive, [0, 1], [52, 0]);
  const camRZ = interpolate(dive, [0, 1], [-28, 0]);
  const camScale = interpolate(dive, [0, 1], [1, wide ? 5.2 : 4.3]);
  const opacity = useTailFade(frame, scene.duration, 6);

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity, overflow: "hidden" }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: height * 1.6 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
            gap,
            transformStyle: "preserve-3d",
            transform: `translateX(${track * (1 - dive)}px) rotateX(${camRX}deg) rotateZ(${camRZ}deg) scale(${camScale})`,
          }}
        >
          {keys.slice(0, rows * cols).map((k, i) => {
            const rowI = Math.floor(i / cols);
            const colI = i % cols;
            const up = sPop({ frame, fps, delay: 2 + (rowI + colI) * 3 });
            const lift = i === hero ? interpolate(frame, [DIVE - 16, DIVE], [0, tileH * 0.25], clamp) : 0;
            const fadeOthers = i === hero ? 1 : 1 - dive;
            return (
              <div
                key={i}
                style={{
                  width: tileW,
                  height: tileH,
                  borderRadius: tileW * 0.12,
                  overflow: "hidden",
                  transform: `translateZ(${interpolate(up, [0, 1], [-tileH, 0]) + lift}px)`,
                  opacity: up * fadeOthers,
                  boxShadow: i === hero ? `0 0 0 ${tileW * 0.02}px ${accent}, 0 ${tileH * 0.1}px ${tileH * 0.2}px ${alpha(accent, 0.35)}` : `0 ${tileH * 0.05}px ${tileH * 0.1}px ${alpha(theme.colors.ink, 0.18)}`,
                  background: theme.colors.white,
                }}
              >
                <Img src={staticFile(src(storyboard, k))} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {c(scene, "title") && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: wide ? "flex-end" : "flex-start", padding: wide ? `0 0 ${height * 0.08}px` : `${height * 0.08}px 0 0`, pointerEvents: "none", opacity: 1 - dive }}>
          <CubeRise
            at={10}
            style={{
              fontFamily: fontHead(theme),
              fontWeight: 800,
              fontSize: wide ? height * 0.07 : width * 0.08,
              color: theme.colors.ink,
              background: alpha(theme.colors.cream, 0.92),
              padding: `${height * 0.012}px ${width * 0.04}px`,
              borderRadius: 999,
              textAlign: "center",
            }}
          >
            {c(scene, "title")} <span style={{ color: accent }}>{c(scene, "titleAccent")}</span>
          </CubeRise>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ── tour ────────────────────────────────────────────────────────────────────
// Features mapped to the screens that prove them: the phone's screen swipes to
// the next screen as the matching feature row lights up.
const Tour: React.FC<ShowreelProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.primary;
  const wide = width > height;
  const feats = ["f1", "f2", "f3", "f4"].map((k) => c(scene, k)).filter(Boolean);
  const list = feats.length ? feats : ["One", "Two", "Three"];
  const keys = screenKeys(scene, storyboard, list.length).slice(0, list.length);
  const span = Math.max(12, Math.floor(scene.duration / list.length));
  const idx = Math.min(list.length - 1, Math.floor(frame / span));
  const local = frame - idx * span;
  const opacity = useTailFade(frame, scene.duration, 10);
  const enter = sSettle({ frame, fps, delay: 0 });
  const swipe = spring({ frame: local, fps, config: { damping: 16, stiffness: 190 } });
  const phoneW = wide ? height * 0.36 : width * 0.5;
  const float = bob(frame, 5, 120);
  const rowSize = wide ? height * 0.05 : width * 0.055;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <AbsoluteFill style={{ flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? width * 0.06 : height * 0.04 }}>
        <div style={{ position: "relative", transform: `translateY(${float}px) rotate(${interpolate(enter, [0, 1], [-8, -3])}deg) scale(${0.8 + enter * 0.2})` }}>
          <div style={{ position: "relative", width: phoneW }}>
            {/* previous screen underneath, next screen swiping up over it */}
            {idx > 0 && local < 20 && (
              <div style={{ position: "absolute", inset: 0 }}>
                <PhoneFrame src={src(storyboard, keys[idx - 1]!)} width={phoneW} glow={alpha(accent, 0.25)} />
              </div>
            )}
            <div style={{ position: "relative", clipPath: idx > 0 ? `inset(${(1 - swipe) * 100}% 0 0 0 round ${phoneW * 0.14}px)` : undefined }}>
              <PhoneFrame src={src(storyboard, keys[idx]!)} width={phoneW} glow={alpha(accent, 0.3)} />
            </div>
          </div>
        </div>
        <CubeList at={4} style={{ display: "flex", flexDirection: "column", gap: rowSize * 0.5, maxWidth: wide ? width * 0.4 : width * 0.84 }}>
          {list.map((f, i) => {
            const active = i === idx;
            const on = interpolate(active ? local : 0, [0, 10], [0, 1], clamp);
            return (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: rowSize * 0.5 }}>
                <div style={{ width: rowSize * 0.28, height: rowSize * (active ? 0.9 : 0.28), borderRadius: rowSize, background: active ? accent : alpha(theme.colors.ink, 0.2), transition: "none" }} />
                <div
                  style={{
                    fontFamily: fontHead(theme),
                    fontWeight: 800,
                    fontSize: rowSize * (active ? 1 : 0.78),
                    color: active ? theme.colors.ink : alpha(theme.colors.ink, 0.35),
                    transform: `translateX(${on * rowSize * 0.3}px)`,
                    lineHeight: 1.1,
                  }}
                >
                  {f}
                </div>
              </div>
            );
          })}
        </CubeList>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── morph ───────────────────────────────────────────────────────────────────
// One shape, one continuous gesture. A dot is born with anticipation, morphs
// into a spinning diamond that throws geometric rings while particles converge
// on it, speed-ramps into a razor-thin bar of light (motion blur from temporal
// samples), then opens vertically into a phone-shaped mask that reveals the
// product screen and settles with follow-through. Behind it, a grid and a huge
// outlined word move at different depths, so the camera reads as parallax.
const RAMP = Easing.bezier(0.85, 0, 0.15, 1); // slow · fast · slow: a speed ramp
const Morph: React.FC<ShowreelProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.primary;
  const wide = width > height;
  const D = scene.duration;
  const m = Math.min(width, height);
  // A screen opens into a phone shape; with no screens the mask is an app icon holding the logo.
  const key = scene.screens?.[0];
  const reveals = key ? src(storyboard, key) : storyboard.logo;
  const phoneW = key ? (wide ? height * 0.36 : width * 0.5) : m * 0.4;
  const phoneH = key ? phoneW * 2.05 : phoneW;
  const opacity = useTailFade(frame, D, 8);
  const seg = (f: number, a: number, b: number, easing = EASE.inOut) => interpolate(f, [a * D, b * D], [0, 1], { ...clamp, easing });

  // The shape as a pure function of time, so earlier frames can be sampled for blur.
  const shapeAt = (f: number) => {
    const born = spring({ frame: f, fps, config: { damping: 9, stiffness: 210, mass: 0.6 } });
    const antic = f < 0.1 * D ? 1 - 0.18 * Math.sin((f / (0.1 * D)) * Math.PI) : 1; // pull back before the pop
    const toDiamond = seg(f, 0.12, 0.36, EASE.out);
    const toBar = seg(f, 0.38, 0.52, RAMP);
    const toPhone = seg(f, 0.54, 0.8, EASE.out);
    const settle = spring({ frame: f - 0.8 * D, fps, config: { damping: 7, stiffness: 150, mass: 0.7 } });
    const dot = m * 0.07;
    const diamond = m * 0.24;
    let w = interpolate(toDiamond, [0, 1], [dot, diamond]);
    let h = w;
    w = interpolate(toBar, [0, 1], [w, wide ? width * 0.86 : width * 0.94]);
    h = interpolate(toBar, [0, 1], [h, m * 0.012]);
    w = interpolate(toPhone, [0, 1], [w, phoneW]);
    h = interpolate(toPhone, [0, 1], [h, phoneH]);
    const radius = toPhone > 0 ? interpolate(toPhone, [0, 1], [m * 0.006, phoneW * (key ? 0.14 : 0.23)]) : interpolate(toDiamond, [0, 1], [w / 2, w * 0.14]);
    const rot = interpolate(toDiamond, [0, 1], [0, 225]) + interpolate(toBar, [0, 1], [0, 135]);
    const overshoot = f >= 0.8 * D ? 1 + (1 - settle) * -0.06 + Math.sin(settle * Math.PI) * 0.035 : 1;
    return { w, h, radius, rot, scale: born * antic * overshoot, toBar, toPhone };
  };

  const now = shapeAt(frame);
  const prev = shapeAt(frame - 1);
  const speed = Math.abs(now.w - prev.w) + Math.abs(now.h - prev.h) + Math.abs(now.rot - prev.rot) * m * 0.002;
  const blur = Math.min(12, speed * 0.09);
  const glow = alpha(accent, 0.55);

  const shapeStyle = (sh: ReturnType<typeof shapeAt>, o: number): React.CSSProperties => ({
    position: "absolute",
    left: "50%",
    top: wide ? "50%" : "46%",
    width: sh.w,
    height: sh.h,
    marginLeft: -sh.w / 2,
    marginTop: -sh.h / 2,
    borderRadius: sh.radius,
    transform: `rotate(${sh.rot}deg) scale(${sh.scale})`,
    opacity: o,
  });

  // Rings thrown by the diamond: three, staggered, each expanding and thinning out.
  const rings = [0.14, 0.2, 0.26].map((start, i) => {
    const t = seg(frame, start, start + 0.3, EASE.out);
    return { t, i };
  });

  // Particles converge on the shape, then burst outward as the mask opens.
  const sparks = new Array(30).fill(0).map((_, i) => {
    const a = (i / 30) * Math.PI * 2 + seed(i) * 0.4;
    const inbound = seg(frame, 0.04 + seed(i + 7) * 0.12, 0.4, EASE.in);
    const burst = seg(frame, 0.54, 0.78, EASE.out);
    const r = interpolate(inbound, [0, 1], [m * (0.7 + seed(i + 3) * 0.5), m * 0.06]) + burst * m * (0.45 + seed(i + 11) * 0.4);
    const o = (inbound < 1 ? interpolate(inbound, [0, 0.15, 1], [0, 0.9, 0.2]) : 0) + (burst > 0 && burst < 1 ? Math.sin(burst * Math.PI) * 0.8 : 0);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, o, size: 3 + seed(i + 5) * 7 };
  });

  const word = c(scene, "word");
  const wordSize = Math.min((wide ? height * 0.36 : width * 0.34) * (7 / Math.max(7, word.length)), wide ? height * 0.34 : width * 0.3);
  const par = interpolate(frame, [0, D], [1, -1], clamp);
  const fill = seg(frame, 0.56, 0.82, EASE.out);
  const reveal = now.toPhone;
  const cy = wide ? height * 0.5 : height * 0.46;

  return (
    <AbsoluteFill style={{ background: bgDark(theme), opacity, overflow: "hidden" }}>
      {/* far layer: a fine grid, slowest, surging during the ramp */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${alpha(theme.colors.white, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.colors.white, 0.05)} 1px, transparent 1px)`,
          backgroundSize: `${m * 0.08}px ${m * 0.08}px`,
          backgroundPosition: `${par * m * 0.04 + now.toBar * m * 0.32}px ${par * m * 0.02}px`,
          transform: `scale(${1.08 + now.toPhone * 0.06})`,
        }}
      />
      {/* mid layer: the word, outlined, drifting against the shape; its fill wipes in as the mask opens */}
      {word && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateX(${par * width * 0.05}px) scale(${1 + now.toPhone * 0.08})` }}>
          <div style={{ position: "relative", fontFamily: fontHead(theme), fontWeight: 800, fontSize: wordSize, letterSpacing: -wordSize * 0.045, lineHeight: 1, whiteSpace: "nowrap" }}>
            <span style={{ color: "transparent", WebkitTextStroke: `${Math.max(2, wordSize * 0.01)}px ${alpha(theme.colors.white, 0.22)}`, opacity: seg(frame, 0.05, 0.3) }}>{word}</span>
            <span style={{ position: "absolute", inset: 0, color: alpha(accent, 0.9), clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}>{word}</span>
          </div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {rings.map(({ t, i }) =>
          t > 0 && t < 1 ? (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: cy,
                width: m * 0.24,
                height: m * 0.24,
                marginLeft: -m * 0.12,
                marginTop: -m * 0.12,
                border: `${Math.max(1, (1 - t) * m * 0.006)}px solid ${i === 1 ? accent : alpha(theme.colors.white, 0.6)}`,
                borderRadius: i === 2 ? "50%" : m * 0.03,
                transform: `rotate(${45 + i * 30 + t * 60}deg) scale(${1 + t * (2.4 + i)})`,
                opacity: 1 - t,
              }}
            />
          ) : null,
        )}
        {sparks.map((p, i) =>
          p.o > 0.01 ? <div key={i} style={{ position: "absolute", left: width / 2 + p.x, top: cy + p.y, width: p.size, height: p.size, marginLeft: -p.size / 2, marginTop: -p.size / 2, borderRadius: "50%", background: i % 3 ? theme.colors.white : accent, opacity: p.o, boxShadow: `0 0 ${p.size * 2}px ${glow}` }} /> : null,
        )}
      </AbsoluteFill>
      {/* near layer: temporal samples behind the shape = motion blur on the fast moves */}
      {blur > 1.5 &&
        [3, 6, 9].map((d, i) => {
          const sh = shapeAt(frame - d);
          return <div key={d} style={{ ...shapeStyle(sh, [0.28, 0.16, 0.08][i]!), background: accent, filter: `blur(${blur * (1 + i * 0.5)}px)` }} />;
        })}
      <div
        style={{
          ...shapeStyle(now, 1),
          overflow: "hidden",
          background: reveal > 0.02 ? theme.colors.ink : accent,
          boxShadow: `0 0 ${m * 0.05 + blur * 4}px ${glow}, 0 0 0 ${Math.max(2, m * 0.004)}px ${alpha(theme.colors.white, reveal > 0.02 ? 0.22 : 0)}`,
          filter: blur > 1.5 ? `blur(${blur * 0.35}px)` : undefined,
        }}
      >
        {reveal > 0.02 && (
          <Img
            src={staticFile(reveals)}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: phoneW,
              height: phoneH,
              marginLeft: -phoneW / 2,
              marginTop: -phoneH / 2,
              objectFit: "cover",
              transform: `rotate(${-now.rot}deg) scale(${interpolate(reveal, [0, 1], [1.35, 1])})`,
              opacity: interpolate(reveal, [0, 0.35], [0, 1], clamp),
            }}
          />
        )}
        {reveal > 0.02 && <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${120 + frame * 0.6}deg, transparent 30%, ${alpha(theme.colors.white, 0.22 * (1 - fill * 0.6))} 48%, transparent 62%)` }} />}
      </div>
      {c(scene, "label") && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: wide ? height * 0.07 : height * 0.06 }}>
          <CubeRise at={Math.round(0.72 * D)} style={{ fontFamily: fontMono(theme), fontSize: wide ? height * 0.026 : width * 0.034, letterSpacing: 6, color: alpha(theme.colors.white, 0.85), textTransform: "uppercase" }}>
            {c(scene, "label")}
          </CubeRise>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export const SHOWREEL_COMPONENTS = {
  kinetic: Kinetic,
  cube: ScreenCube,
  wall: Wall,
  tour: Tour,
  morph: Morph,
} as const;
