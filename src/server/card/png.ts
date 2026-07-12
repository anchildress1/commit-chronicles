import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
import { CARD } from './layout.js';

/**
 * The card's own fonts, vendored.
 *
 * The runtime image has no fonts at all, and the SVG asks for its families by name — so
 * without these the headline rasterizes to nothing. They are loaded explicitly rather than
 * left to fontconfig, so the PNG does not depend on what a base image happens to ship.
 */
const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts', import.meta.url));

/**
 * Rasterize the card.
 *
 * dev.to proxies remote images and will not serve an SVG, so the PNG is the card as far as
 * every embed is concerned. It also settles the webfont problem for good: the type is baked
 * into the pixels, and no proxy has to fetch a font for the card to read correctly.
 *
 * @param svg The rendered card markup.
 * @returns PNG bytes at the card's natural size.
 */
export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD.width },
    font: {
      fontDirs: [FONT_DIR],
      // The image has no system fonts to fall back to, so a miss must not silently
      // resolve to nothing.
      loadSystemFonts: false,
      defaultFontFamily: 'Hanken Grotesk',
      serifFamily: 'Bodoni Moda',
      sansSerifFamily: 'Hanken Grotesk',
      monospaceFamily: 'Space Mono',
    },
  });

  return resvg.render().asPng();
}
