export const PRINT_RASTER_DPI = 1200;
export const PRINT_TILE_WIDTH = 4096;
export const PRINT_TILE_HEIGHT = 1024;

export function printRasterSize(widthPoints, heightPoints) {
  const width = Math.ceil(widthPoints * PRINT_RASTER_DPI / 72);
  const height = Math.ceil(heightPoints * PRINT_RASTER_DPI / 72);
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('This PDF page has an invalid size.');
  return { width, height };
}

// Keep each canvas at four megapixels rather than allocating a full 1200 dpi page.
export function printRasterTiles(width, height) {
  return (function* () {
    for (let y = 0; y < height; y += PRINT_TILE_HEIGHT) {
      for (let x = 0; x < width; x += PRINT_TILE_WIDTH) {
        yield { x, y, width: Math.min(PRINT_TILE_WIDTH, width - x), height: Math.min(PRINT_TILE_HEIGHT, height - y) };
      }
    }
  })();
}
