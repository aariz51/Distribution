import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import { DEFAULT_THEME, KitProps, demoStoryboard } from "./schema";

/**
 * Four deliverables, one component. Size comes from the composition; everything
 * else comes from `inputProps`, and `calculateMetadata` lets the storyboard set
 * its own fps and length so a 22-second film and a 40-second film need no code
 * change. `defaultProps` is a neutral demo so Studio and a fresh clone render.
 */
const DELIVERABLES = [
  { id: "PromoVertical", width: 1080, height: 1920 },
  { id: "PromoLandscape", width: 1920, height: 1080 },
  { id: "PromoStorePortrait", width: 886, height: 1920 },
  { id: "PromoStoreLandscape", width: 1920, height: 886 },
] as const;

export const RemotionRoot: React.FC = () => (
  <>
    {DELIVERABLES.map((d) => (
      <Composition
        key={d.id}
        id={d.id}
        component={Film}
        schema={KitProps}
        defaultProps={{ storyboard: demoStoryboard(d.width, d.height), theme: DEFAULT_THEME }}
        width={d.width}
        height={d.height}
        fps={60}
        durationInFrames={2100}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.storyboard.durationFrames,
          fps: props.storyboard.fps,
          props,
        })}
      />
    ))}
  </>
);
