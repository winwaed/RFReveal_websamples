// node --test test/  (Node 18 or later)
import { test } from "node:test";
import assert from "node:assert/strict";

import { WORLD, extentSummary, maskPaths } from "../extent.js";

const square = (x0, y0, x1, y1, cw = false) => {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  return cw ? ring.reverse() : ring;
};

const feature = {
  type: "Feature",
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [square(-98.6, 33.8, -98.4, 34.0), square(-98.55, 33.85, -98.5, 33.9, true)],
      [square(-98.3, 33.8, -98.2, 33.9)],
    ],
  },
  properties: { name: "wichitafalls", area_km2: 810.25, tiles: 810, islands: 2, holes: 1 },
};

test("maskPaths: the world ring, then every ring of the feature in lat/lng", () => {
  const paths = maskPaths(feature);
  assert.equal(paths.length, 4);
  assert.equal(paths[0], WORLD);
  assert.deepEqual(paths[1][0], { lat: 33.8, lng: -98.6 });
  assert.deepEqual(paths[1][1], { lat: 33.8, lng: -98.4 });
  assert.equal(paths[1].length, 5);
  // The hole keeps its own (clockwise) order.
  assert.deepEqual(paths[2][0], { lat: 33.85, lng: -98.55 });
  assert.deepEqual(paths[2][1], { lat: 33.9, lng: -98.55 });
  assert.deepEqual(paths[3][0], { lat: 33.8, lng: -98.3 });
  // A plain Polygon works too, and no geometry gives the world alone.
  assert.equal(maskPaths({ type: "Feature", geometry: { type: "Polygon", coordinates: [square(0, 0, 1, 1)] } }).length, 2);
  assert.deepEqual(maskPaths(null), [WORLD]);
});

test("the world ring is clockwise and within Web Mercator", () => {
  let area = 0;
  for (let i = 0; i < WORLD.length; i++) {
    const a = WORLD[i], b = WORLD[(i + 1) % WORLD.length];
    area += a.lng * b.lat - b.lng * a.lat;
  }
  assert.ok(area < 0, "clockwise (negative area in lng/lat)");
  for (const p of WORLD) assert.ok(Math.abs(p.lat) <= 85.06);
});

test("extentSummary", () => {
  assert.equal(extentSummary(feature), "wichitafalls, 810 km², 810 tiles, 2 islands, 1 hole");
  assert.equal(extentSummary({ properties: { name: "x", area_km2: 1, tiles: 1, islands: 1, holes: 0 } }), "x, 1 km², 1 tiles");
  assert.equal(extentSummary(null), "");
});
