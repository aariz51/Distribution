import React, { useEffect, useState } from "react";
import { delayRender, continueRender } from "remotion";
import { fontFaceCss } from "../fonts";
import { useTheme } from "../theme";

// Render-safe font loading: inject @font-face CSS for the theme's font files,
// request the head/body faces, and hold the render (delayRender) until
// document.fonts.ready resolves. delayRender is called inside the component.
export const FontLoader: React.FC = () => {
  const theme = useTheme();
  const [handle] = useState(() => delayRender("Loading film fonts"));

  useEffect(() => {
    let cancelled = false;
    const fams = [theme.fonts.head, theme.fonts.body];
    const loads = fams.flatMap((f) => ["500", "700", "800"].map((w) => document.fonts.load(`${w} 40px "${f}"`)));
    Promise.all(loads)
      .then(() => document.fonts.ready)
      .then(() => {
        if (!cancelled) continueRender(handle);
      })
      .catch(() => {
        if (!cancelled) continueRender(handle); // never hang on a font error
      });
    return () => {
      cancelled = true;
    };
  }, [handle, theme]);

  return <style>{fontFaceCss(theme)}</style>;
};
