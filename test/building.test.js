// Unit tests for the pure parts of building.js:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";

const { batches, bestRadiosPerTower, buildBuildingRequest, buildingColor, checkBuildings, coverageColor, distanceM, hilbertIndex, mercator, ringCentroid, selectWithin, toFeature } =
  await import("../building.js");

// A square footprint of side m metres (roughly) at (lat, lon).
function square(id, lat, lon, m = 20, extra = {}) {
  const dlat = m / 111320;
  const dlon = m / (111320 * Math.cos((lat * Math.PI) / 180));
  return { id, rings: [[[lon, lat], [lon + dlon, lat], [lon + dlon, lat + dlat], [lon, lat + dlat], [lon, lat]]], building: "house", ...extra };
}

test("checkBuildings validates and adds centroids", () => {
  const b = checkBuildings([square("w1", 33.9, -98.5), square("r2", 33.91, -98.51, 20, { name: "Hall", levels: 2 })]);
  assert.equal(b.length, 2);
  assert.ok(Math.abs(b[0].centroid.lat - 33.9000898) < 1e-5 && Math.abs(b[0].centroid.lon + 98.4998917) < 1e-5, JSON.stringify(b[0].centroid));
  assert.equal(b[1].name, "Hall");
  assert.throws(() => checkBuildings({}), /array/);
  assert.throws(() => checkBuildings([{ id: "x" }]), /rings/);
  assert.throws(() => checkBuildings([square("a", 1, 1), square("a", 1, 1)]), /duplicate/);
  assert.throws(() => checkBuildings([{ id: "x", rings: [[[1, 2], [3, 4], [1, 2]]] }]), /at least 4/);
});

test("ringCentroid ignores the closing position", () => {
  const c = ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  assert.deepEqual(c, { lat: 1, lon: 1 });
});

test("distanceM and selectWithin", () => {
  const wt = { lat: 33.9201, lon: -98.5012 };
  assert.ok(Math.abs(distanceM(wt, { lat: 33.9291, lon: -98.5012 }) - 1001) < 5, "1 km north");
  assert.ok(Math.abs(distanceM(wt, { lat: 33.9201, lon: -98.4904 }) - 1000) < 10, "1 km east");
  const b = checkBuildings([square("near", 33.9205, -98.5010), square("far", 33.94, -98.5012), square("other", 33.8670, -98.5340)]);
  const towers = [{ id: "wt", ...wt }, { id: "chase", lat: 33.8664, lon: -98.53435 }];
  assert.deepEqual(selectWithin(b, towers, 500).map((x) => x.id), ["near", "other"]);
  assert.deepEqual(selectWithin(b, [towers[0]], 500).map((x) => x.id), ["near"]);
  assert.deepEqual(selectWithin(b, towers, 3000).map((x) => x.id), ["near", "far", "other"]);
});

test("mercator matches PROJ control points", () => {
  const p = mercator({ lat: 33.9137, lon: -98.4934 });
  assert.ok(Math.abs(p.x + 10964235.1345) < 0.01 && Math.abs(p.y - 4017219.9227) < 0.01, JSON.stringify(p));
});

test("batches groups neighbours and respects the maximum", () => {
  const b = checkBuildings([
    square("a", 33.9000, -98.5000), square("b", 33.9001, -98.5001), // same 200 m square
    square("c", 33.9100, -98.5000), // 1.1 km north
    square("d", 33.9000, -98.4900), // 920 m east of a
  ]);
  const one = batches(b, { max: 400 });
  assert.equal(one.length, 1);
  // Along the Hilbert curve from the south-west square: a and b (the same
  // square, in input order) first; the curve then climbs the western
  // column before crossing east, so c (a kilometre north) precedes d
  // (920 m east).
  assert.deepEqual(one[0].map((x) => x.id), ["a", "b", "c", "d"]);
  const two = batches(b, { max: 3 });
  assert.deepEqual(two.map((x) => x.length), [3, 1]);
  assert.equal(two[1][0].id, "d");
  assert.deepEqual(batches([], { max: 3 }), []);
});

test("hilbertIndex walks the grid without jumps", () => {
  assert.deepEqual([hilbertIndex(2, 0, 0), hilbertIndex(2, 0, 1), hilbertIndex(2, 1, 1), hilbertIndex(2, 1, 0)], [0, 1, 2, 3]);
  const n = 16;
  const at = new Array(n * n);
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) at[hilbertIndex(n, x, y)] = [x, y];
  assert.ok(at.every(Boolean), "a permutation of the cells");
  for (let d = 1; d < n * n; d++) {
    assert.equal(Math.abs(at[d][0] - at[d - 1][0]) + Math.abs(at[d][1] - at[d - 1][1]), 1, `step ${d}`);
  }
});

test("batches cut along the curve are compact blocks", () => {
  // One building in each 200 m Mercator square of a 16 x 16 grid
  // (3.2 km), listed column by column; four batches of 64 are then the
  // four 8 x 8 quadrants, whatever the input order.
  const R = 6378137;
  const o = mercator({ lat: 33.9, lon: -98.5 });
  const b = [];
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = (Math.floor(o.x / 200) + i) * 200 + 100;
      const y = (Math.floor(o.y / 200) + j) * 200 + 100;
      b.push(square(`${i}-${j}`, ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI, (x / R) * 180 / Math.PI));
    }
  }
  const parts = batches(checkBuildings(b), { max: 64 });
  assert.deepEqual(parts.map((p) => p.length), [64, 64, 64, 64]);
  for (const part of parts) {
    const sq = part.map((x) => mercator(x.centroid)).map((p) => [Math.floor(p.x / 200), Math.floor(p.y / 200)]);
    const span = (k) => Math.max(...sq.map((s) => s[k])) - Math.min(...sq.map((s) => s[k]));
    assert.equal(new Set(sq.map(String)).size, 64, "one building per square");
    assert.ok(span(0) === 7 && span(1) === 7, `an 8 x 8 block, got ${span(0) + 1} x ${span(1) + 1}`);
  }
});

test("buildBuildingRequest sends GeoJSON polygons and the roof height", () => {
  const b = checkBuildings([square("w1", 33.9, -98.5, 20, { name: "Hall" }), square("w2", 33.9, -98.49)]);
  const towers = [{ id: "wt", name: "Water tower", lat: 33.9201, lon: -98.5012, radios: [{ id: "wt-0", azimuth_deg: 0, height: 45 }] }];
  const req = buildBuildingRequest({ buildings: b, towers, aboveSurface: 2, minSignalDbm: -80, atmosphere: "wet" });
  assert.equal(req.units, "metric");
  assert.equal(req.min_signal_dbm, -80);
  assert.equal(req.signal_rank, 3);
  assert.equal(req.detail, "radios");
  assert.deepEqual(req.rx_height, { above_surface: 2 });
  assert.deepEqual(req.options, { atmosphere: "wet" });
  assert.equal(req.buildings.length, 2);
  assert.equal(req.buildings[0].id, "w1");
  assert.equal(req.buildings[0].name, "Hall");
  assert.equal(req.buildings[1].name, "");
  assert.equal(req.buildings[0].geometry.type, "Polygon");
  assert.equal(req.buildings[0].geometry.coordinates[0].length, 5);
  assert.equal(req.buildings[0].centroid, undefined, "page-only fields stay out of the request");
  assert.deepEqual(req.towers[0].radios, towers[0].radios);
  // Both path types count by default (0/1 integers), no clearance sent.
  assert.equal(req.enable_los, 1);
  assert.equal(req.enable_nlos, 1);
  assert.equal(req.rxclearance, undefined);
  const nlosOff = buildBuildingRequest({ buildings: b, towers, aboveSurface: 2, minSignalDbm: -80, enableNLOS: false, rxClearance: 4 });
  assert.equal(nlosOff.enable_los, 1);
  assert.equal(nlosOff.enable_nlos, 0);
  assert.equal(nlosOff.rxclearance, 4);
  const none = buildBuildingRequest({ buildings: b, towers, aboveSurface: 2, minSignalDbm: -80 });
  assert.equal(none.options, undefined);
  // The service's cell raster option is never asked for.
  assert.equal(none.raster, undefined);
});

test("toFeature wraps the rings as a GeoJSON Feature", () => {
  const f = toFeature(checkBuildings([square("w1", 33.9, -98.5)])[0]);
  assert.equal(f.type, "Feature");
  assert.equal(f.id, "w1");
  assert.equal(f.geometry.type, "Polygon");
  assert.equal(f.geometry.coordinates[0].length, 5);
});

test("colours: coverage runs grey, red to green; signal uses the signal ramp", () => {
  assert.deepEqual(coverageColor(0), [158, 158, 158]);
  const [r1, g1] = coverageColor(5);
  const [r2, g2] = coverageColor(100);
  assert.ok(r1 > g1, "little coverage is red");
  assert.ok(g2 > r2, "full coverage is green");
  assert.deepEqual(buildingColor({ skipped: "no_cells" }), [120, 120, 120]);
  assert.deepEqual(buildingColor({ combined: { coverage_pct: 0, signal_dbm: null } }), [158, 158, 158]);
  assert.deepEqual(buildingColor({ combined: { coverage_pct: 40, signal_dbm: null } }, { by: "signal" }), [158, 158, 158]);
  const [rs, gs] = buildingColor({ combined: { coverage_pct: 40, signal_dbm: -50 } }, { by: "signal" });
  assert.ok(gs > rs, "a strong signal is green");
  assert.deepEqual(buildingColor(null), [120, 120, 120]);
});

test("bestRadiosPerTower picks one radio per tower", () => {
  const reply = {
    towers: [
      { id: "a", name: "A", radios: [{ id: "a1", name: "N" }, { id: "a2", name: "S" }] },
      { id: "b", name: "B", radios: [{ id: "b1", name: "E" }] },
    ],
  };
  const building = {
    radios: [
      { tower: "a", radio: "a1", skipped: null, coverage_pct: 40, signal_dbm: -70 },
      { tower: "a", radio: "a2", skipped: null, coverage_pct: 40, signal_dbm: -60 },
      { tower: "b", radio: "b1", skipped: "beyond_range" },
    ],
  };
  const rows = bestRadiosPerTower(building, reply);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tower.id, "a");
  assert.equal(rows[0].radio.radio, "a2");
  assert.equal(rows[0].radio.name, "S");
});
