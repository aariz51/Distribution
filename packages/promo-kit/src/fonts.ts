import { staticFile } from "remotion";
import type { Theme } from "./schema";

/** @font-face CSS for every font file the theme names. Injected by <FontLoader/>. */
export function fontFaceCss(theme: Theme): string {
  return theme.fonts.files
    .map(
      (f) => `
@font-face {
  font-family: '${f.family}';
  src: url('${staticFile(f.src)}') format('truetype');
  font-weight: ${f.weight};
  font-style: normal;
  font-display: block;
}`,
    )
    .join("\n");
}
