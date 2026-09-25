import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TRANSITION_FRAMES, type KitProps, type Transition } from "./schema";
import { ThemeContext } from "./theme";
import { FontLoader } from "./components/FontLoader";
import { SCENE_COMPONENTS } from "./scenes";
import { OutTransitionContext } from "./scenes/tail";
import { EASE } from "./animations/easings";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The incoming half of a transition: this scene arrives over the previous one. */
const TransitionIn: React.FC<{ type: Transition; frames: number; children: React.ReactNode }> = ({ type, frames, children }) => {
  const frame = useCurrentFrame();
  if (type === "cut" || frames === 0 || frame >= frames) return <AbsoluteFill>{children}</AbsoluteFill>;
  const p = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: EASE.inOut });
  switch (type) {
    case "iris":
      return <AbsoluteFill style={{ clipPath: `circle(${p * 75}% at 50% 50%)` }}>{children}</AbsoluteFill>;
    case "slash": {
      const x = -30 + p * 160;
      return <AbsoluteFill style={{ clipPath: `polygon(0 0, ${x}% 0, ${x - 30}% 100%, 0 100%)` }}>{children}</AbsoluteFill>;
    }
    case "push":
      return <AbsoluteFill style={{ transform: `translateX(${(1 - p) * 100}%)` }}>{children}</AbsoluteFill>;
    case "zoom":
      return <AbsoluteFill style={{ transform: `scale(${1.45 - 0.45 * p})`, filter: `blur(${(1 - p) * 16}px)`, opacity: p }}>{children}</AbsoluteFill>;
    case "flash":
      return (
        <AbsoluteFill>
          {children}
          <AbsoluteFill style={{ background: "#ffffff", opacity: interpolate(frame, [0, frames], [1, 0], { ...clamp, easing: EASE.out }) }} />
        </AbsoluteFill>
      );
  }
};

/** The outgoing half: push and zoom move the scene being replaced as well. */
const TransitionOut: React.FC<{ type: Transition | null; start: number; frames: number; children: React.ReactNode }> = ({ type, start, frames, children }) => {
  const frame = useCurrentFrame();
  if (!type || frames === 0 || frame < start) return <AbsoluteFill>{children}</AbsoluteFill>;
  const q = interpolate(frame, [start, start + frames], [0, 1], { ...clamp, easing: EASE.inOut });
  if (type === "push") return <AbsoluteFill style={{ transform: `translateX(${-q * 35}%)`, filter: `brightness(${1 - q * 0.35})` }}>{children}</AbsoluteFill>;
  if (type === "zoom") return <AbsoluteFill style={{ transform: `scale(${1 + q * 0.4})`, filter: `blur(${q * 12}px)` }}>{children}</AbsoluteFill>;
  return <AbsoluteFill>{children}</AbsoluteFill>;
};

/** Scenes whose content settles and holds get a slow camera push, so a hold still breathes. */
const DRIFT_KINDS = new Set(["features", "logo", "tagline", "typewriter", "steps", "split", "oneTap", "verdict"]);
const Drift: React.FC<{ on: boolean; duration: number; children: React.ReactNode }> = ({ on, duration, children }) => {
  const frame = useCurrentFrame();
  if (!on) return <AbsoluteFill>{children}</AbsoluteFill>;
  const s = interpolate(frame, [0, duration], [1, 1.045], { ...clamp, easing: EASE.inOut });
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

/**
 * The film is a pure projection of the storyboard: one `<Sequence>` per scene,
 * each rendered by the kit component for its `kind`. A scene followed by a
 * non-cut transition stays mounted for the overlap so the next scene can arrive
 * over it. Timing, copy, screens, colours and the audio master arrive as props,
 * so a new film is a new JSON document rather than new TSX.
 */
export const Film: React.FC<KitProps> = ({ storyboard, theme }) => {
  const { fps } = useVideoConfig();
  const T = Math.round((TRANSITION_FRAMES * fps) / 60);
  const scenes = storyboard.scenes;
  return (
    <ThemeContext.Provider value={theme}>
      <AbsoluteFill style={{ backgroundColor: theme.colors.cream }}>
        <FontLoader />
        {scenes.map((scene, i) => {
          const Component = SCENE_COMPONENTS[scene.kind];
          const next = scenes[i + 1];
          const outFrames = next && next.transition !== "cut" ? Math.min(T, next.duration) : 0;
          const inFrames = i > 0 && scene.transition !== "cut" ? Math.min(T, scene.duration) : 0;
          return (
            <Sequence key={scene.id} from={scene.start} durationInFrames={scene.duration + outFrames} name={`${scene.kind} · ${scene.id}`}>
              <OutTransitionContext.Provider value={outFrames > 0}>
                <TransitionOut type={outFrames ? next!.transition : null} start={scene.duration} frames={outFrames}>
                  <TransitionIn type={scene.transition} frames={inFrames}>
                    <Drift on={DRIFT_KINDS.has(scene.kind)} duration={scene.duration}>
                      <Component scene={scene} storyboard={storyboard} />
                    </Drift>
                  </TransitionIn>
                </TransitionOut>
              </OutTransitionContext.Provider>
            </Sequence>
          );
        })}
        {storyboard.audioSrc ? <Audio src={staticFile(storyboard.audioSrc)} /> : null}
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
};
