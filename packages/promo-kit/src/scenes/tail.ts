import { createContext, useContext } from "react";
import { tailFade } from "../animations/motion";

/**
 * True while the next scene transitions over this one. A scene covered by an
 * iris, slash, push, zoom or flash must stay fully visible underneath, so its
 * own tail fade is skipped; on a hard cut it still fades as before.
 */
export const OutTransitionContext = createContext(false);

export function useTailFade(frame: number, duration: number, frames = 14): number {
  const covered = useContext(OutTransitionContext);
  return covered ? 1 : tailFade(frame, duration, frames);
}
