import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { KitProps } from "./schema";
import { ThemeContext } from "./theme";
import { FontLoader } from "./components/FontLoader";
import { SCENE_COMPONENTS } from "./scenes";

/**
 * The film is a pure projection of the storyboard: one `<Sequence>` per scene,
 * each rendered by the kit component for its `kind`. Timing, copy, screens,
 * colours and the audio master all arrive as props, so a new film is a new JSON
 * document rather than new TSX.
 */
export const Film: React.FC<KitProps> = ({ storyboard, theme }) => {
  return (
    <ThemeContext.Provider value={theme}>
      <AbsoluteFill style={{ backgroundColor: theme.colors.cream }}>
        <FontLoader />
        {storyboard.scenes.map((scene) => {
          const Component = SCENE_COMPONENTS[scene.kind];
          return (
            <Sequence key={scene.id} from={scene.start} durationInFrames={scene.duration} name={`${scene.kind} · ${scene.id}`}>
              <Component scene={scene} storyboard={storyboard} />
            </Sequence>
          );
        })}
        {storyboard.audioSrc ? <Audio src={staticFile(storyboard.audioSrc)} /> : null}
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
};
