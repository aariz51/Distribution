// ════════════════════════════════════════════════════════════════════════════
//  THE SCENE KIT — every scene is a pure function of (scene, storyboard, theme).
//  Nothing here knows a product name or a colour: copy arrives in `scene.copy`,
//  screens in `scene.screens`, colour from the theme context. That is what lets
//  a storyboard JSON drive the whole film without an agent writing TSX.
//
//  Twelve kinds: the nine scene *jobs* the template demonstrated, plus three
//  signature devices from docs/scene-kit.md (typewriter bookend, split screen,
//  numbered steps) so a reference whose grammar is not "phone on a cream field"
//  still has components to land on.
// ════════════════════════════════════════════════════════════════════════════
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, SceneKind, Storyboard } from "../schema";
import { alpha, bgDark, bgRadial, fontBody, fontHead, fontMono, useTheme } from "../theme";
import { EASE } from "../animations/easings";
import { bob, pulse, pushIn, ramp, seed, tailFade } from "../animations/motion";
import { sBounce, sEnter, sPop, sSettle } from "../animations/springs";
import { ActionButton } from "../components/ActionButton";
import { Bloom } from "../components/Bloom";
import { Confetti } from "../components/Confetti";
import { Cursor } from "../components/Cursor";
import { GlassCard } from "../components/GlassCard";
import { KineticWords } from "../components/KineticWords";
import { Particles } from "../components/Particles";
import { PhoneFrame } from "../components/PhoneFrame";
import { ScoreRing } from "../components/ScoreRing";
import { Whoosh } from "../components/Whoosh";

export interface SceneProps {
  scene: Scene;
  storyboard: Storyboard;
}

/** Copy slot with a fallback, so a storyboard that omits a key still renders. */
const c = (s: Scene, key: string, fallback = ""): string => s.copy[key] ?? fallback;

/** Resolve a screen key through the storyboard's map; throws if it is missing so
 *  a headless render fails loudly instead of shipping a broken frame. */
function screenSrc(sb: Storyboard, key: string): string {
  const path = sb.screens[key];
  if (!path) {
    throw new Error(`storyboard references screen "${key}" which is not in storyboard.screens (have: ${Object.keys(sb.screens).join(", ") || "none"})`);
  }
  return path;
}

function useSceneAccent(scene: Scene): string {
  const theme = useTheme();
  return scene.accent ?? theme.colors.primary;
}

// ── hook ────────────────────────────────────────────────────────────────────
// One typographic line that states the problem, with the last word carrying the
// accent. A glyph floats behind it. Nothing moves fast; this beat is the inhale.
const Hook: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;

  const scale = pushIn(frame, 0, scene.duration, 1.06, 1.14);
  const opacity = tailFade(frame, scene.duration, 16);
  const glyphIn = sPop({ frame, fps, delay: 10 });
  const glyphFloat = bob(frame, 10, 130);
  const glow = pulse(frame, 70);

  const line = c(scene, "line", "Every day, the same question.");
  const parts = line.trim().split(/\s+/);
  const words = parts.map((text, i) => ({ text, color: i === parts.length - 1 ? accent : undefined }));

  return (
    <AbsoluteFill style={{ background: bgRadial(theme) }}>
      <Particles count={18} opacity={0.8} />
      <AbsoluteFill style={{ transform: `scale(${scale})`, opacity, alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.52 : width * 0.62,
            fontWeight: 800,
            color: alpha(accent, 0.07 + glow * 0.04),
            transform: `translateY(${glyphFloat - 40}px) scale(${0.8 + glyphIn * 0.2})`,
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {c(scene, "glyph", "?")}
        </div>
        <div style={{ position: "relative", textAlign: "center", padding: wide ? "0 12%" : "0 8%" }}>
          <KineticWords words={words} fontSize={wide ? height * 0.085 : width * 0.105} startAt={8} stagger={7} maxWidth={wide ? "70%" : "86%"} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── oneTap ──────────────────────────────────────────────────────────────────
// The claim: one action replaces the problem. Two lines, second one coloured,
// with the action itself sitting under them waiting to be pressed.
const OneTap: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;

  const opacity = tailFade(frame, scene.duration, 14);
  const l1 = sEnter({ frame, fps, delay: 4 });
  const l2 = sEnter({ frame, fps, delay: 14 });
  const btn = sBounce({ frame, fps, delay: 26 });
  const float = bob(frame, 7, 110);
  const size = wide ? height * 0.088 : width * 0.115;
  const btnSize = wide ? height * 0.26 : width * 0.3;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <Bloom frame={frame} peak={4} rise={4} fall={12} color={theme.colors.white} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: wide ? height * 0.06 : width * 0.1 }}>
        <div style={{ textAlign: "center", fontFamily: fontHead(theme), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
          <div style={{ fontSize: size, color: theme.colors.ink, opacity: l1, transform: `translateY(${(1 - l1) * 26}px)` }}>{c(scene, "line1", "One tap.")}</div>
          <div style={{ fontSize: size, color: accent, opacity: l2, transform: `translateY(${(1 - l2) * 26}px)` }}>{c(scene, "line2", "Zero doubt.")}</div>
        </div>
        <div style={{ transform: `translateY(${float}px) scale(${0.6 + btn * 0.4})`, opacity: btn }}>
          <ActionButton size={btnSize} label={c(scene, "buttonLabel", "START")} color={accent} glowStrength={0.6} />
        </div>
      </AbsoluteFill>
      <Cursor
        x={width * (wide ? 0.62 : 0.68)}
        y={interpolate(frame, [0, scene.duration], [height * 1.02, height * 0.63], { extrapolateRight: "clamp", easing: EASE.out })}
        scale={wide ? 1.4 : 1.8}
      />
    </AbsoluteFill>
  );
};

// ── press ───────────────────────────────────────────────────────────────────
// Interaction proof. The cursor lands, the control answers, and the frame dives
// through it. Short, physical, no text — the cut does the talking.
const Press: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const PRESS_AT = Math.round(scene.duration * 0.28);

  const press = interpolate(frame, [PRESS_AT - 4, PRESS_AT, PRESS_AT + 8], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dive = frame < PRESS_AT ? 1 : interpolate(frame, [PRESS_AT, scene.duration], [1, 3.4], { extrapolateRight: "clamp", easing: EASE.in });
  const ringT = Math.max(0, frame - PRESS_AT);
  const ringScale = interpolate(ringT, [0, 26], [0.2, 2.4], { extrapolateRight: "clamp", easing: EASE.out });
  const ringOpacity = interpolate(ringT, [0, 26], [0.5, 0], { extrapolateRight: "clamp" });
  const btnSize = wide ? height * 0.26 : width * 0.3;
  const ring = Math.min(width, height) * 0.85;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme) }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${dive})` }}>
        {ringT > 0 && (
          <div
            style={{
              position: "absolute",
              width: ring,
              height: ring,
              borderRadius: "50%",
              border: `${Math.max(2, ring * 0.006)}px solid ${alpha(accent, ringOpacity)}`,
              transform: `scale(${ringScale})`,
            }}
          />
        )}
        <ActionButton size={btnSize} label={c(scene, "buttonLabel", "START")} color={accent} press={press} glowStrength={0.5 + press * 0.5} />
        <Cursor x={width * 0.5 + btnSize * 0.1} y={height * 0.5 + btnSize * 0.08} scale={wide ? 1.4 : 1.8} pressed={press} />
      </AbsoluteFill>
      <Bloom frame={frame} peak={scene.duration - 3} rise={6} fall={3} color={theme.colors.white} />
    </AbsoluteFill>
  );
};

// ── verdict ─────────────────────────────────────────────────────────────────
// The payoff. A measured result lands on a ring, the verdict pill snaps in, and
// the reward fires once. This is the beat the whole film is buying.
const Verdict: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = scene.accent ?? theme.colors.safe;
  const wide = width > height;
  const REWARD = Math.round(scene.duration * 0.55);

  const recover = interpolate(frame, [0, 10], [1, 0], { extrapolateRight: "clamp" });
  const eyebrow = sEnter({ frame, fps, delay: 4 });
  const subject = sEnter({ frame, fps, delay: 10 });
  const pill = sPop({ frame, fps, delay: REWARD });
  const opacity = tailFade(frame, scene.duration, 14);
  const score = Number(c(scene, "score", "92")) || 92;
  const ringSize = wide ? height * 0.42 : width * 0.52;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: wide ? height * 0.035 : width * 0.06 }}>
        <div
          style={{
            fontFamily: fontBody(theme),
            fontSize: wide ? height * 0.026 : width * 0.033,
            fontWeight: 700,
            letterSpacing: 3,
            color: accent,
            background: alpha(accent, 0.1),
            padding: `${wide ? height * 0.012 : width * 0.016}px ${wide ? height * 0.026 : width * 0.036}px`,
            borderRadius: 999,
            opacity: eyebrow,
            transform: `translateY(${(1 - eyebrow) * 14}px)`,
          }}
        >
          {c(scene, "eyebrow", "RESULT")}
        </div>
        <div
          style={{
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.062 : width * 0.075,
            fontWeight: 800,
            color: theme.colors.ink,
            opacity: subject,
            transform: `translateY(${(1 - subject) * 18}px)`,
            textAlign: "center",
            maxWidth: "80%",
          }}
        >
          {c(scene, "subject", "Your result")}
        </div>
        <ScoreRing frame={frame} score={score} size={ringSize} stroke={ringSize * 0.075} color={accent} start={6} span={44} />
        <div
          style={{
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.038 : width * 0.048,
            fontWeight: 800,
            letterSpacing: 1,
            color: theme.colors.white,
            background: accent,
            padding: `${wide ? height * 0.014 : width * 0.018}px ${wide ? height * 0.034 : width * 0.046}px`,
            borderRadius: 999,
            transform: `scale(${0.7 + pill * 0.3})`,
            opacity: pill,
            boxShadow: `0 ${ringSize * 0.04}px ${ringSize * 0.1}px ${alpha(accent, 0.3)}`,
          }}
        >
          {c(scene, "verdict", "ALL CLEAR")}
        </div>
      </AbsoluteFill>
      <Confetti frame={frame} start={REWARD} count={110} life={Math.max(60, scene.duration - REWARD)} />
      {recover > 0 && <AbsoluteFill style={{ background: theme.colors.white, opacity: recover }} />}
    </AbsoluteFill>
  );
};

// ── features ────────────────────────────────────────────────────────────────
// Breadth without a list: three glass cards, fanned wide or stacked tall.
const Features: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 14);
  const title = sEnter({ frame, fps, delay: 3 });

  const items = [
    { t: c(scene, "f1", "Fast"), s: c(scene, "f1sub", ""), tint: accent },
    { t: c(scene, "f2", "Clear"), s: c(scene, "f2sub", ""), tint: theme.colors.primary },
    { t: c(scene, "f3", "Yours"), s: c(scene, "f3sub", ""), tint: theme.colors.gold },
  ].filter((i) => i.t);

  const cardW = wide ? height * 0.3 : width * 0.84;
  const cardH = wide ? height * 0.36 : width * 0.2;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <Whoosh frame={frame} start={0} span={26} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: wide ? height * 0.06 : width * 0.07, padding: wide ? "0 6%" : "0 8%" }}>
        <div
          style={{
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.062 : width * 0.082,
            fontWeight: 800,
            color: theme.colors.ink,
            textAlign: "center",
            opacity: title,
            transform: `translateY(${(1 - title) * 20}px)`,
          }}
        >
          {c(scene, "title", "More than")} <span style={{ color: accent }}>{c(scene, "titleAccent", "one answer.")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: wide ? "row" : "column", gap: wide ? height * 0.03 : width * 0.035, alignItems: "center" }}>
          {items.map((item, i) => {
            const e = sEnter({ frame, fps, delay: 12 + i * 8 });
            const rot = wide ? (i - 1) * 4 : 0;
            return (
              <div key={item.t} style={{ opacity: e, transform: `translateY(${(1 - e) * 30}px) rotate(${rot}deg)` }}>
                <GlassCard width={cardW} height={cardH} tint={item.tint} glow={alpha(item.tint, 0.25)}>
                  <div style={{ padding: cardW * 0.09, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: cardW * 0.03 }}>
                    <div style={{ width: cardW * 0.14, height: cardW * 0.14, borderRadius: cardW * 0.045, background: alpha(item.tint, 0.18), border: `2px solid ${alpha(item.tint, 0.4)}` }} />
                    <div style={{ fontFamily: fontHead(theme), fontSize: cardW * 0.11, fontWeight: 800, color: theme.colors.ink, lineHeight: 1.1 }}>{item.t}</div>
                    {item.s && <div style={{ fontFamily: fontBody(theme), fontSize: cardW * 0.062, color: theme.colors.inkSoft, lineHeight: 1.3 }}>{item.s}</div>}
                  </div>
                </GlassCard>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── orbit ───────────────────────────────────────────────────────────────────
// Range, shown rather than claimed: the product's screens circle an ellipse,
// depth-sorted so the ring reads as space instead of a carousel.
const Orbit: React.FC<SceneProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 14);
  const enter = sSettle({ frame, fps, delay: 2 });

  const keys = scene.screens?.length ? scene.screens : Object.keys(storyboard.screens).slice(0, 6);
  const cx = width / 2;
  const cy = height * (wide ? 0.52 : 0.46);
  const rx = Math.min(width * 0.42, wide ? height * 0.6 : width * 0.44);
  const ry = wide ? height * 0.24 : height * 0.17;
  const phoneW = wide ? height * 0.24 : width * 0.24;
  const spin = frame * 0.0045;

  const items = keys.map((key, i) => {
    const a = spin + (i / keys.length) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const depth = (Math.sin(a) + 1) / 2;
    return { key, x, y, depth, scale: 0.72 + depth * 0.42 };
  });
  items.sort((a, b) => a.depth - b.depth);

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      {items.map((it) => (
        <div
          key={it.key}
          style={{
            position: "absolute",
            left: it.x,
            top: it.y,
            transform: `translate(-50%, -50%) scale(${it.scale * enter})`,
            opacity: 0.4 + it.depth * 0.6,
            filter: it.depth < 0.35 ? `blur(${(0.35 - it.depth) * 10}px)` : undefined,
          }}
        >
          <PhoneFrame src={screenSrc(storyboard, it.key)} width={phoneW} glow={alpha(accent, 0.22)} />
        </div>
      ))}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: wide ? "center" : "flex-start", paddingTop: wide ? 0 : height * 0.1, pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.062 : width * 0.08,
            fontWeight: 800,
            color: theme.colors.ink,
            textAlign: "center",
            maxWidth: "76%",
            background: `radial-gradient(ellipse at center, ${alpha(theme.colors.cream, 0.96)} 40%, ${alpha(theme.colors.cream, 0)} 72%)`,
            padding: `${height * 0.03}px ${width * 0.05}px`,
          }}
        >
          <span style={{ color: accent }}>{c(scene, "titleAccent", "Everything")}</span> {c(scene, "titleRest", "built around you.")}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── dashboard ───────────────────────────────────────────────────────────────
// The money shot: the screen that carries the product's value, held long enough
// to read, tilted into the light, with one callout that names what you see.
const Dashboard: React.FC<SceneProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 14);
  const TAP = Math.round(scene.duration * 0.32);

  const rise = sSettle({ frame, fps, delay: 2 });
  const tilt = interpolate(rise, [0, 1], [20, 3]);
  const press = interpolate(frame, [TAP - 4, TAP, TAP + 8], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const callout = sPop({ frame, fps, delay: TAP + 4 });
  const float = bob(frame, 6, 150);

  const key = scene.screens?.[0] ?? Object.keys(storyboard.screens)[0] ?? "dashboard";
  const phoneW = wide ? height * 0.52 : width * 0.62;
  const cardW = wide ? height * 0.3 : width * 0.5;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <Bloom frame={frame} peak={3} rise={3} fall={12} color={theme.colors.white} />
      <AbsoluteFill style={{ flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? width * 0.05 : height * 0.04, padding: wide ? "0 8%" : `${height * 0.06}px 0` }}>
        {!wide && (
          <div style={{ fontFamily: fontHead(theme), fontSize: width * 0.078, fontWeight: 800, color: theme.colors.ink, textAlign: "center", maxWidth: "80%" }}>
            {c(scene, "pre", "One calm")} <span style={{ color: accent }}>{c(scene, "accent", "place")}</span> {c(scene, "post", "for all of it.")}
          </div>
        )}
        <div style={{ perspective: 1600, transform: `translateY(${float}px)` }}>
          <div style={{ transform: `rotateX(${tilt}deg) scale(${0.86 + rise * 0.14})`, transformStyle: "preserve-3d" }}>
            <PhoneFrame src={screenSrc(storyboard, key)} width={phoneW} glow={alpha(accent, 0.3)} />
          </div>
        </div>
        {wide && (
          <div style={{ fontFamily: fontHead(theme), fontSize: height * 0.068, fontWeight: 800, color: theme.colors.ink, maxWidth: width * 0.3 }}>
            {c(scene, "pre", "One calm")} <span style={{ color: accent }}>{c(scene, "accent", "place")}</span> {c(scene, "post", "for all of it.")}
          </div>
        )}
      </AbsoluteFill>
      {c(scene, "chip") && (
        <div
          style={{
            position: "absolute",
            left: wide ? width * 0.42 : width * 0.56,
            top: wide ? height * 0.24 : height * 0.3,
            transform: `scale(${0.7 + callout * 0.3})`,
            opacity: callout,
          }}
        >
          <GlassCard width={cardW} height={cardW * 0.42} tint={accent} glow={alpha(accent, 0.3)}>
            <div style={{ padding: cardW * 0.08, display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
              <div style={{ fontFamily: fontHead(theme), fontSize: cardW * 0.13, fontWeight: 800, color: theme.colors.ink }}>{c(scene, "chip")}</div>
              <div style={{ fontFamily: fontBody(theme), fontSize: cardW * 0.075, color: theme.colors.inkSoft }}>{c(scene, "chipSub")}</div>
            </div>
          </GlassCard>
        </div>
      )}
      <Cursor x={width * 0.5} y={height * (wide ? 0.55 : 0.52)} scale={wide ? 1.3 : 1.6} pressed={press} />
    </AbsoluteFill>
  );
};

// ── tagline ─────────────────────────────────────────────────────────────────
// Three words on a fixed beat. The rhythm is the message.
const Tagline: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 12);
  const beat = Math.max(10, Math.round(scene.duration / 8));

  const words = [c(scene, "w1", "Ask."), c(scene, "w2", "Know."), c(scene, "w3", "Move.")].filter(Boolean);
  const colors = [theme.colors.ink, accent, theme.colors.gold];

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <AbsoluteFill style={{ flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? width * 0.03 : height * 0.01 }}>
        {words.map((w, i) => {
          const p = sPop({ frame, fps, delay: i * beat });
          return (
            <div
              key={w}
              style={{
                fontFamily: fontHead(theme),
                fontSize: wide ? height * 0.13 : width * 0.16,
                fontWeight: 800,
                letterSpacing: -2,
                color: colors[i % colors.length],
                opacity: p,
                transform: `scale(${0.7 + p * 0.3})`,
              }}
            >
              {w}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── logo ────────────────────────────────────────────────────────────────────
// The exit, and the smallest thing in the film: lockup, one line, where to get it.
const Logo: React.FC<SceneProps> = ({ scene, storyboard }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;

  const enter = sSettle({ frame, fps, delay: 2 });
  const beat = 1 + pulse(frame, 90) * 0.012;
  const line = sEnter({ frame, fps, delay: 16 });
  const badges = sEnter({ frame, fps, delay: 26 });
  const logoSize = wide ? height * 0.3 : width * 0.42;

  const badge = (top: string, main: string, key: string) =>
    main ? (
      <div
        key={key}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: `${logoSize * 0.05}px ${logoSize * 0.11}px`,
          borderRadius: logoSize * 0.06,
          background: theme.colors.ink,
          color: theme.colors.white,
          fontFamily: fontBody(theme),
          lineHeight: 1.15,
        }}
      >
        <span style={{ fontSize: logoSize * 0.055, opacity: 0.7 }}>{top}</span>
        <span style={{ fontSize: logoSize * 0.085, fontWeight: 700 }}>{main}</span>
      </div>
    ) : null;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme) }}>
      <Bloom frame={frame} peak={4} rise={4} fall={16} color={theme.colors.white} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: logoSize * 0.13 }}>
        <div style={{ transform: `scale(${(0.82 + enter * 0.18) * beat})`, opacity: enter }}>
          <div
            style={{
              width: logoSize,
              height: logoSize,
              borderRadius: logoSize * 0.24,
              overflow: "hidden",
              background: theme.colors.white,
              boxShadow: `0 ${logoSize * 0.06}px ${logoSize * 0.16}px ${alpha(theme.colors.ink, 0.14)}, 0 0 ${logoSize * 0.3}px ${alpha(accent, 0.18)}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Img src={staticFile(storyboard.logo)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
        <div
          style={{
            fontFamily: fontHead(theme),
            fontSize: wide ? height * 0.052 : width * 0.062,
            fontWeight: 800,
            color: theme.colors.ink,
            opacity: line,
            transform: `translateY(${(1 - line) * 16}px)`,
          }}
        >
          {storyboard.product.name}
        </div>
        <div
          style={{
            fontFamily: fontBody(theme),
            fontSize: wide ? height * 0.026 : width * 0.033,
            color: theme.colors.inkSoft,
            opacity: line,
            textAlign: "center",
            maxWidth: "76%",
          }}
        >
          {c(scene, "tagline", storyboard.product.tagline)}
        </div>
        <div style={{ display: "flex", gap: logoSize * 0.08, opacity: badges, transform: `translateY(${(1 - badges) * 14}px)` }}>
          {badge(c(scene, "badge1Top", "Download on the"), c(scene, "badge1", "App Store"), "b1")}
          {badge(c(scene, "badge2Top", "GET IT ON"), c(scene, "badge2", "Google Play"), "b2")}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── typewriter (signature device) ───────────────────────────────────────────
// A monospace line typed against a caret, on light or inverted ground. Used as
// a bookend when the reference's voice is "system speaking", not "brand saying".
const Typewriter: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const dark = scene.options?.ground === "dark";

  const text = c(scene, "line", "");
  const typeFor = Math.round(scene.duration * 0.62);
  const shown = Math.floor(ramp(frame, 0, text.length, 6, typeFor, EASE.out));
  const caretOn = Math.floor(frame / 16) % 2 === 0 || frame < typeFor;
  const opacity = tailFade(frame, scene.duration, 12);
  const ink = dark ? theme.colors.white : theme.colors.ink;
  const label = c(scene, "label", "");

  return (
    <AbsoluteFill style={{ background: dark ? bgDark(theme) : bgRadial(theme), opacity }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: wide ? "0 12%" : "0 8%", gap: height * 0.035 }}>
        {label && (
          <div style={{ fontFamily: fontMono(theme), fontSize: wide ? height * 0.024 : width * 0.03, letterSpacing: 4, color: accent, textTransform: "uppercase" }}>{label}</div>
        )}
        <div
          style={{
            fontFamily: fontMono(theme),
            fontSize: wide ? height * 0.062 : width * 0.072,
            fontWeight: 500,
            color: ink,
            lineHeight: 1.3,
            textAlign: "center",
            letterSpacing: -0.5,
          }}
        >
          {text.slice(0, shown)}
          <span style={{ opacity: caretOn ? 1 : 0, color: accent }}>▌</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── split (signature device) ────────────────────────────────────────────────
// The user's world on a light ground, the system's work on a dark one, meeting
// at a hard vertical seam. Two truths at once, without a transition.
const Split: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 14);
  const seam = interpolate(sSettle({ frame, fps, delay: 0 }), [0, 1], [wide ? 0.5 : 0.5, 0.5]);

  const leftItems = [c(scene, "left1"), c(scene, "left2"), c(scene, "left3")].filter(Boolean);
  const rightItems = [c(scene, "right1"), c(scene, "right2"), c(scene, "right3")].filter(Boolean);
  const titleSize = wide ? height * 0.045 : width * 0.05;
  const itemSize = wide ? height * 0.026 : width * 0.032;

  const panel = (title: string, items: string[], isDark: boolean, delay: number) => (
    <div
      style={{
        flex: 1,
        background: isDark ? theme.colors.ink : theme.colors.cream,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: itemSize * 0.9,
        padding: wide ? `0 ${width * 0.045}px` : `${height * 0.05}px ${width * 0.09}px`,
      }}
    >
      <div style={{ fontFamily: fontHead(theme), fontSize: titleSize, fontWeight: 800, color: isDark ? theme.colors.white : theme.colors.ink, marginBottom: itemSize * 0.4 }}>{title}</div>
      {items.map((it, i) => {
        const e = sEnter({ frame, fps, delay: delay + i * 7 });
        return (
          <div
            key={it}
            style={{
              fontFamily: isDark ? fontMono(theme) : fontBody(theme),
              fontSize: itemSize,
              color: isDark ? alpha(theme.colors.white, 0.82) : theme.colors.inkSoft,
              opacity: e,
              transform: `translateX(${(1 - e) * (isDark ? 18 : -18)}px)`,
              display: "flex",
              alignItems: "center",
              gap: itemSize * 0.5,
            }}
          >
            <span style={{ width: itemSize * 0.34, height: itemSize * 0.34, borderRadius: "50%", background: isDark ? accent : alpha(theme.colors.ink, 0.25), flexShrink: 0 }} />
            {it}
          </div>
        );
      })}
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ flexDirection: wide ? "row" : "column" }}>
        {panel(c(scene, "leftTitle", "You"), leftItems, false, 6)}
        {panel(c(scene, "rightTitle", "It"), rightItems, true, 12)}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          ...(wide ? { left: `${seam * 100}%`, top: 0, width: 2, height: "100%" } : { top: `${seam * 100}%`, left: 0, height: 2, width: "100%" }),
          background: alpha(accent, 0.6),
        }}
      />
    </AbsoluteFill>
  );
};

// ── steps (signature device) ────────────────────────────────────────────────
// Numbered rows that arrive in sequence. For references whose grammar is a
// procedure rather than a reveal.
const Steps: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const theme = useTheme();
  const accent = useSceneAccent(scene);
  const wide = width > height;
  const opacity = tailFade(frame, scene.duration, 14);
  const title = sEnter({ frame, fps, delay: 2 });

  const rows = [
    { t: c(scene, "s1"), s: c(scene, "s1sub") },
    { t: c(scene, "s2"), s: c(scene, "s2sub") },
    { t: c(scene, "s3"), s: c(scene, "s3sub") },
    { t: c(scene, "s4"), s: c(scene, "s4sub") },
  ].filter((r) => r.t);

  const rowSize = wide ? height * 0.05 : width * 0.056;

  return (
    <AbsoluteFill style={{ background: bgRadial(theme), opacity }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: wide ? "0 14%" : "0 9%", gap: rowSize * 0.8 }}>
        {c(scene, "title") && (
          <div
            style={{
              fontFamily: fontHead(theme),
              fontSize: wide ? height * 0.058 : width * 0.072,
              fontWeight: 800,
              color: theme.colors.ink,
              opacity: title,
              transform: `translateY(${(1 - title) * 18}px)`,
              marginBottom: rowSize * 0.5,
              textAlign: "center",
            }}
          >
            {c(scene, "title")}
          </div>
        )}
        {rows.map((r, i) => {
          const e = sEnter({ frame, fps, delay: 10 + i * 10 });
          return (
            <div
              key={r.t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: rowSize * 0.6,
                width: "100%",
                opacity: e,
                transform: `translateY(${(1 - e) * 24}px)`,
                borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                paddingBottom: rowSize * 0.5,
              }}
            >
              <div style={{ fontFamily: fontMono(theme), fontSize: rowSize * 0.72, fontWeight: 700, color: accent, minWidth: rowSize * 1.2 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: rowSize * 0.1 }}>
                <div style={{ fontFamily: fontHead(theme), fontSize: rowSize, fontWeight: 700, color: theme.colors.ink, lineHeight: 1.15 }}>{r.t}</div>
                {r.s && <div style={{ fontFamily: fontBody(theme), fontSize: rowSize * 0.5, color: theme.colors.inkSoft }}>{r.s}</div>}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Every scene kind the storyboard may use. */
export const SCENE_COMPONENTS: Record<SceneKind, React.FC<SceneProps>> = {
  hook: Hook,
  oneTap: OneTap,
  press: Press,
  verdict: Verdict,
  features: Features,
  orbit: Orbit,
  dashboard: Dashboard,
  tagline: Tagline,
  logo: Logo,
  typewriter: Typewriter,
  split: Split,
  steps: Steps,
};

// `seed` keeps deterministic randomness available to future scenes; referenced
// here so the import is not dropped by the bundler in dev builds.
export const __deterministic = seed;
