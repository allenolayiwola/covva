import { contentMaxWidth, creaseBand, gridColumns, isWide, readingPane, usablePanes } from '../layout';

it.each([[375, false], [466, false], [599, false], [600, true], [669, true], [768, true], [951, true], [1024, true]])('classifies width %s', (width, wide) => {
  expect(isWide(width as number)).toBe(wide);
});
it('caps reading and grids and reflows columns', () => {
  expect(contentMaxWidth()).toBe(720);
  expect(contentMaxWidth('grid')).toBe(1100);
  expect([327, 621, 1000, 2000].map(width => gridColumns(width))).toEqual([1, 2, 3, 3]);
});
it.each([669, 951, 1024])('never guesses a crease at width %s', width => {
  expect(creaseBand(null)).toBeNull();
  expect(usablePanes({ x: 0, width }, null)).toEqual([{ x: 0, width }]);
});
it.each([669, 951])('keeps every content rectangle outside a reported crease at %s', width => {
  const fold = { x: width / 2, width: 0, separating: true };
  const band = creaseBand(fold)!;
  expect(band.width).toBe(40);
  const bounds = { x: 24, width: width - 48 };
  const rectangles = [...usablePanes(bounds, fold), readingPane(bounds, fold)];
  for (const rectangle of rectangles) {
    expect(rectangle.x + rectangle.width <= band.x || rectangle.x >= band.x + band.width).toBe(true);
  }
});
it('honors asymmetric safe bounds and ignores nonseparating folds', () => {
  expect(readingPane({ x: 0, width: 466 - 84 }, null)).toEqual({ x: 0, width: 382 });
  expect(creaseBand({ x: 400, width: 12, separating: false })).toBeNull();
});
