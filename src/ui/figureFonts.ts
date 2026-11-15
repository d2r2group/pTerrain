// The `@font-face` rules that embed Lato (latin subset, regular, italic and bold) in a PNG export's
// SVG (plan §8 phase 16 (c)): a browser draws an SVG loaded as an image without the page's fonts.
// Imported only when a PNG is made, so that the page's bundle does not carry the fonts twice.

import lato400 from "@fontsource/lato/files/lato-latin-400-normal.woff2?inline";
import lato400Italic from "@fontsource/lato/files/lato-latin-400-italic.woff2?inline";
import lato700 from "@fontsource/lato/files/lato-latin-700-normal.woff2?inline";

const face = (style: string, weight: number, url: string) =>
  `@font-face{font-family:Lato;font-style:${style};font-weight:${weight};` +
  `src:url(${url}) format("woff2")}`;

export const FONT_FACES =
  face("normal", 400, lato400) + face("italic", 400, lato400Italic) + face("normal", 700, lato700);
