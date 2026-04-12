import Masonry from 'masonry-layout';
import imagesLoaded from 'imagesloaded';

export const GAP = 12;
export const DEFAULT_CARD_WIDTH = 220;

/**
 * Compute the actual card pixel width that fills a container evenly,
 * given a target card width. Figures out how many columns fit at the
 * target size and expands them to fill the full container width.
 */
export function calcColumnWidth(innerWidth, targetCardWidth) {
  const cols = Math.max(1, Math.floor((innerWidth + GAP) / (targetCardWidth + GAP)));
  return Math.floor((innerWidth - (cols - 1) * GAP) / cols);
}

/**
 * Create and return a Masonry instance for the given grid element.
 * itemSelector should be the card class specific to the page.
 */
export function initMasonry(gridEl, itemSelector) {
  return new Masonry(gridEl, {
    itemSelector,
    columnWidth:      '.grid-sizer',
    gutter:           GAP,
    percentPosition:  false,
    transitionDuration: 0,
  });
}

/**
 * Re-layout after all images in the grid have loaded (or errored).
 */
export function layoutAfterImages(gridEl, msnry) {
  imagesLoaded(gridEl, () => msnry.layout());
}
