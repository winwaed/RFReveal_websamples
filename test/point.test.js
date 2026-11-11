// Unit tests for the pure parts of point.js:  node --test
import { test } from "node:test";
import assert from "node:assert/strict";

const { NO_PATH, bestRadio, buildPointRequest, degrees, heightText, lineStyle, towerRows } = await import("../point.js");
const { signalColor } = await import("../patch.js");

const towers = [{ id: "t", name: "T", lat: 33.9, lon: -98.5, radios: [{ id: "t-90", azimuth_deg: 90 }] }];

test("buildPointRequest is the patch request without the patch", () => {
  const req = buildPointRequest({ lat: 33.91, lon: -98.49, towers, aboveGround: 5, aboveSurface: 2, minSignalDbm: -80, enableNLOS: false, rxClearance: 4 });
  assert.equal(req.units, "metric");
  assert.deepEqual(req.location, { lat: 33.91, lon: -98.49 });
  assert.equal(req.radius, undefined);
  assert.deepEqual(req.rx_height, { above_ground: 5, above_surface: 2 });
  assert.equal(req.min_signal_dbm, -80);
  assert.equal(req.enable_los, 1);
  assert.equal(req.enable_nlos, 0);
  assert.equal(req.rxclearance, 4);
  assert.equal(req.options, undefined);
  assert.deepEqual(req.towers[0].radios, towers[0].radios);
  // The buildings mode sends the surface height only; the atmosphere goes
  // in options.
  const roof = buildPointRequest({ lat: 1, lon: 2, towers, aboveSurface: 2, minSignalDbm: -80, atmosphere: "dry" });
  assert.deepEqual(roof.rx_height, { above_surface: 2 });
  assert.deepEqual(roof.options, { atmosphere: "dry" });
  assert.equal(roof.rxclearance, undefined);
});

const reply = {
  towers: [
    { id: "a", name: "A", distance: 1.2, azimuth_deg: 100, azimuth_to_tower_deg: 280, radios: [
      { id: "a1", skipped: null, signal_dbm: -70, path: "nlos", covered: true },
      { id: "a2", skipped: null, signal_dbm: -60, path: "los", covered: true },
      { id: "a3", skipped: "beyond_range" },
    ] },
    { id: "b", name: "B", distance: 3.4, azimuth_deg: 10, azimuth_to_tower_deg: 190, radios: [
      { id: "b1", skipped: null, signal_dbm: -95, path: "nlos", covered: false },
      { id: "b2", skipped: null, signal_dbm: null, path: null, covered: false },
    ] },
    { id: "c", name: "C", distance: 9, azimuth_deg: 0, azimuth_to_tower_deg: 180, radios: [{ id: "c1", skipped: "beyond_max_distance" }, { id: "c2", skipped: "beyond_range" }] },
    { id: "d", name: "D", distance: 2, azimuth_deg: 0, azimuth_to_tower_deg: 180, radios: [{ id: "d1", skipped: null, signal_dbm: null, path: null, covered: false }] },
  ],
};

test("bestRadio and towerRows pick the strongest covered radio per tower", () => {
  assert.equal(bestRadio(reply.towers[0]).id, "a2", "LOS -60 beats NLOS -70");
  assert.equal(bestRadio(reply.towers[1]).id, "b1", "a signal below the minimum still shows");
  assert.equal(bestRadio(reply.towers[2]), null);
  assert.equal(bestRadio(reply.towers[3]), null);
  // A covered radio beats a stronger uncovered one.
  assert.equal(bestRadio({ radios: [{ signal_dbm: -50, covered: false }, { signal_dbm: -79, covered: true }] }).signal_dbm, -79);
  const rows = towerRows(reply);
  assert.deepEqual(rows.map((r) => [r.tower.id, r.signal, r.path, r.covered, r.skipped]), [
    ["a", -60, "los", true, ""],
    ["b", -95, "nlos", false, ""],
    ["c", null, null, false, "beyond_max_distance, beyond_range"],
    ["d", null, null, false, ""],
  ]);
  assert.equal(rows[0].azimuthToTower, 280);
  assert.equal(rows[0].azimuthFromTower, 100);
  assert.equal(rows[0].distance, 1.2);
});

test("lineStyle: palette and dash follow the signal and the path", () => {
  const rows = towerRows(reply);
  assert.deepEqual(lineStyle(rows[0], { weak: -80 }), { color: signalColor(-60, { weak: -80 }), dash: "solid" });
  assert.deepEqual(lineStyle(rows[1], { weak: -80 }), { color: signalColor(-95, { weak: -80 }), dash: "dashed" });
  assert.deepEqual(lineStyle(rows[2]), { color: NO_PATH, dash: "dotted" });
  assert.deepEqual(lineStyle(rows[3]), { color: NO_PATH, dash: "dotted" });
});

test("formatting helpers", () => {
  assert.equal(degrees(279.6), "280°");
  assert.equal(degrees(null), "–");
  assert.equal(heightText({ rx_height: { above_ground: 5, above_surface: 2 } }), "5 m above ground or 2 m above the surface");
  assert.equal(heightText({ rx_height: { above_surface: 2 } }), "2 m above the surface");
});
