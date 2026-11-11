// Unit tests for the pure parts of patch.js, run with Node's own test
// runner (no npm):  node --test
// The vendored browser bundles are loaded as globals, as the page does;
// geotiff.js's bundle wants a few browser globals to exist at load time.
// The raster test uses a live reply when a service is reachable at
// RFREVEALD_URL (default http://127.0.0.1:8080) and is skipped otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.Worker = class {};
const require = createRequire(import.meta.url);
// Under require() the UMD bundle exports instead of setting the global.
globalThis.GeoTIFF = require("../vendor/geotiff-2.1.3.js");

const { PATH_LOS, PATH_NLOS, buildRequest, decodeRaster, flagsValid, maskUnder, mercatorToLatLon, mergeStrongest, pathFlags, pixelIndex, rasterToRGBA, signalColor } =
  await import("../patch.js");
const { expandTowers } = await import("../towers.js");
const TOWERS_DOC = JSON.parse(await readFile(new URL("../towers.json", import.meta.url), "utf8"));
const { towers: TOWERS, center } = expandTowers(TOWERS_DOC);

test("towers.json expands to the three sample towers", () => {
  assert.deepEqual(TOWERS.map((t) => t.id), ["chase", "water-tower", "northwest", "downtown-60"]);
  // The 60 GHz tower's radios carry their own antenna, frequency and
  // polarization over the defaults, and the rooftop mount.
  const d60 = TOWERS[3];
  assert.ok(d60.radios.every((r) => r.antenna === "cn-v5000-integrated-sector-60g" && r.frequency_ghz === 60.48 && r.polarization === "vertical" && r.height_rooftop === 4 && r.range === 2 && r.apclearance === 30));
  assert.deepEqual(center, { lat: 33.9137, lng: -98.4934 });
  const chase = TOWERS[0];
  assert.deepEqual(chase.radios.map((r) => r.id), ["chase-45", "chase-135", "chase-225", "chase-315"]);
  assert.equal(chase.radios[0].name, "NE sector");
  assert.equal(chase.radios[0].antenna, "cn-450-micropop-sector-antenna-5g");
  assert.equal(chase.height_rooftop, undefined, "the mount moves onto the radios");
  // A radio's own field beats the defaults; a tower's mount is inherited.
  const doc = {
    towers: [{ id: "t", name: "T", lat: 1, lon: 2, height: 10, radios: [{ azimuth_deg: 90, tilt_deg: -5 }, { azimuth_deg: 180, height_rooftop: 3 }] }],
    radio_defaults: { tilt_deg: -2, range: 5 },
  };
  const { towers, center: c } = expandTowers(doc);
  assert.deepEqual(towers[0].radios[0], { azimuth_deg: 90, tilt_deg: -5, range: 5, id: "t-90", name: "90°", height: 10 });
  assert.deepEqual(towers[0].radios[1], { azimuth_deg: 180, tilt_deg: -2, range: 5, id: "t-180", name: "180°", height_rooftop: 3 });
  assert.deepEqual(c, { lat: 1, lng: 2 }, "the centre falls back to the first tower");
  // Bad files are refused with the place named.
  assert.throws(() => expandTowers({ towers: [] }), /non-empty/);
  assert.throws(() => expandTowers({ towers: [{ id: "a", name: "A", lat: 0, lon: 0, radios: [{ azimuth_deg: 0 }] }] }), /no height/);
  assert.throws(() => expandTowers({ towers: [{ id: "a", name: "A", lat: 0, lon: 0, height: 1, height_rooftop: 2, radios: [{ azimuth_deg: 0 }] }] }), /both/);
  assert.throws(() => expandTowers({ towers: [{ id: "a", name: "A", lat: 0, lon: 0, height: 1, radios: [{ name: "x" }] }] }), /azimuth_deg/);
});

test("buildRequest uses only the given towers and heights", () => {
  const req = buildRequest({ lat: 1, lon: 2, towers: [TOWERS[0]], radius: 100, aboveGround: 5, aboveSurface: 0, minSignalDbm: -90 });
  assert.equal(req.units, "metric");
  assert.deepEqual(req.location, { lat: 1, lon: 2 });
  assert.deepEqual(req.rx_height, { above_ground: 5 });
  assert.equal(req.towers.length, 1);
  assert.equal(req.towers[0].id, "chase");
  assert.equal(req.towers[0].name, "Chase");
  assert.equal(req.towers[0].radios.length, 4);
  assert.deepEqual(req.towers[0].radios.map((r) => r.azimuth_deg), [45, 135, 225, 315]);
  assert.ok(req.towers[0].radios.every((r) => r.range === 20));
  // Chase is mounted on its roof, so it gives height_rooftop and no height.
  assert.ok(req.towers[0].radios.every((r) => r.height_rooftop === 6 && r.height === undefined));
  // Every radio ignores obstructions within 30 m of itself.
  assert.ok(req.towers.every((t) => t.radios.every((r) => r.apclearance === 30)));
  assert.equal(req.min_signal_dbm, -90);
  assert.equal(req.options, undefined, "no options in mode none");
  const wet = buildRequest({ lat: 1, lon: 2, towers: [TOWERS[0]], radius: 100, aboveGround: 5, aboveSurface: 0, minSignalDbm: -90, atmosphere: "wet" });
  assert.deepEqual(wet.options, { atmosphere: "wet" });
  // Both path types count by default, as 0/1 integers (the service
  // rejects booleans), and the receiver clearance is left to the service
  // unless given.
  assert.equal(req.enable_los, 1);
  assert.equal(req.enable_nlos, 1);
  assert.equal(req.rxclearance, undefined);
});

test("path flags and the receiver clearance reach the request", () => {
  const base = { lat: 1, lon: 2, towers: [TOWERS[0]], radius: 100, aboveGround: 5, aboveSurface: 0, minSignalDbm: -90 };
  const nlosOnly = buildRequest({ ...base, enableLOS: false, enableNLOS: true, rxClearance: 5 });
  assert.equal(nlosOnly.enable_los, 0);
  assert.equal(nlosOnly.enable_nlos, 1);
  assert.equal(nlosOnly.rxclearance, 5);
  const losOnly = buildRequest({ ...base, enableNLOS: false, rxClearance: 0 });
  assert.equal(losOnly.enable_los, 1);
  assert.equal(losOnly.enable_nlos, 0);
  assert.equal(losOnly.rxclearance, undefined, "a zero clearance is not sent");
  assert.deepEqual(pathFlags({ enableLOS: true, enableNLOS: false, rxClearance: 2.5 }), { enable_los: 1, enable_nlos: 0, rxclearance: 2.5 });
  assert.ok(flagsValid({ enableLOS: true, enableNLOS: false }));
  assert.ok(flagsValid({ enableLOS: false, enableNLOS: true }));
  assert.ok(!flagsValid({ enableLOS: false, enableNLOS: false }), "neither path type is refused before the service sees it");
});

test("mercatorToLatLon matches PROJ control points", () => {
  const a = mercatorToLatLon(-10964235.1345, 4017219.9227);
  assert.ok(Math.abs(a.lat - 33.9137) < 1e-6 && Math.abs(a.lon + 98.4934) < 1e-6, JSON.stringify(a));
  const b = mercatorToLatLon(1113194.9079, 11068715.6594);
  assert.ok(Math.abs(b.lat - 70) < 1e-6 && Math.abs(b.lon - 10) < 1e-6, JSON.stringify(b));
  assert.deepEqual(mercatorToLatLon(0, 0), { lat: 0, lon: 0 });
});

test("signalColor runs green to red", () => {
  const [r1, g1] = signalColor(-45);
  const [r2, g2] = signalColor(-100);
  assert.ok(g1 > r1, "strong is green");
  assert.ok(r2 > g2, "weak is red");
});

test("rasterToRGBA leaves nodata transparent and scales", () => {
  const decoded = { width: 2, height: 1, nodata: 255, values: Uint8Array.from([60, 255]) };
  const img = rasterToRGBA(decoded, { scale: 2, alpha: 200 });
  assert.equal(img.width, 4);
  assert.equal(img.height, 2);
  assert.equal(img.data[3], 200); // first pixel painted
  assert.equal(img.data[2 * 4 + 3], 0); // third pixel (second cell) transparent
});

test("rasterToRGBA hatches non-line-of-sight pixels", () => {
  // Two cells at the same level, one reached by LOS and one by NLOS,
  // drawn 4 x 4 image pixels each with a hatch line every 4 diagonals.
  const decoded = { width: 2, height: 1, nodata: 255, values: Uint8Array.from([60, 60]), paths: Uint8Array.from([PATH_LOS, PATH_NLOS]) };
  const img = rasterToRGBA(decoded, { scale: 4, alpha: 255, hatch: 4 });
  const px = (x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
  const plain = px(0, 0);
  assert.deepEqual(px(1, 0), plain, "the LOS cell is uniform");
  assert.deepEqual(px(5, 0), plain, "an NLOS pixel off the hatch line keeps the ramp colour");
  const dark = px(4, 0); // x + y = 4: on the hatch line
  assert.ok(dark.every((c, i) => c < plain[i] || plain[i] === 0), `hatch line is darker: ${dark} vs ${plain}`);
  assert.deepEqual(px(7, 1), dark, "x + y = 8 is the next line");
  // A one-band raster (NLOS off) and hatch 0 draw no hatching.
  const flat = rasterToRGBA({ ...decoded, paths: null }, { scale: 4, alpha: 255 });
  assert.deepEqual(Array.from(flat.data.slice(16, 19)), plain);
  const off = rasterToRGBA(decoded, { scale: 4, alpha: 255, hatch: 0 });
  assert.deepEqual(Array.from(off.data.slice(16, 19)), plain);
});

// grid builds a small patch: w x h pixels of 1 m at Mercator origin (x0, y0),
// values from a function of (i, j).
function grid(x0, y0, w, h, f) {
  const values = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) values[j * w + i] = f(i, j);
  return { width: w, height: h, nodata: 255, values, mercator: { x0, y0, dx: 1, dy: -1 } };
}

test("pixelIndex maps Mercator points to pixels", () => {
  const d = grid(100, 200, 4, 3, () => 0);
  assert.equal(pixelIndex(d, 100.5, 199.5), 0); // upper-left pixel
  assert.equal(pixelIndex(d, 103.5, 197.5), 11); // lower-right pixel
  assert.equal(pixelIndex(d, 99.5, 199.5), -1);
  assert.equal(pixelIndex(d, 100.5, 196.5), -1);
});

test("overlapping patches show the strongest signal once", () => {
  // Two 4 x 4 patches at -70 dBm, the second shifted 2 m east and 2 m
  // south, so they share a 2 x 2 block.
  const a = grid(0, 10, 4, 4, () => 70);
  const b = grid(2, 8, 4, 4, () => 70);
  const mb = mergeStrongest(b, [a]);
  b.merged = mb.values;
  assert.ok(b.merged.every((v) => v === 70), "equal levels merge to the same level");
  assert.equal(mb.paths, null, "no path band when no patch has one");
  a.mask = maskUnder(a, b);
  // a hides exactly its pixels under b: columns 2-3 of rows 2-3.
  const hidden = [];
  for (let k = 0; k < 16; k++) if (!a.mask[k]) hidden.push(k);
  assert.deepEqual(hidden, [10, 11, 14, 15]);
  // Painted: one image draws each map pixel exactly once.
  const ia = rasterToRGBA(a, { scale: 1, alpha: 170 });
  const ib = rasterToRGBA(b, { scale: 1, alpha: 170 });
  assert.equal(ia.data[10 * 4 + 3], 0, "a's pixel under b is transparent");
  assert.equal(ia.data[0 * 4 + 3], 170, "a still draws elsewhere");
  assert.equal(ib.data[0 * 4 + 3], 170, "b draws the shared block");

  // A stronger earlier patch wins inside the new one, and a nodata pixel
  // of the new patch takes the earlier value.
  const c = grid(0, 10, 4, 4, (i, j) => (j === 0 ? 255 : 60)); // row 0 nodata, rest -60 dBm
  const d = grid(2, 8, 4, 4, () => 70);
  d.merged = mergeStrongest(d, [c]).values;
  assert.equal(d.merged[0], 60, "shared pixel takes the stronger -60 dBm");
  assert.equal(d.merged[3], 70, "pixel outside c keeps its own value");
  const e = grid(0, 10, 4, 4, () => 255); // all nodata
  const f = grid(0, 10, 4, 4, () => 80);
  e.merged = mergeStrongest(e, [f]).values;
  assert.ok(e.merged.every((v) => v === 80), "nodata takes the earlier value");
  // A patch far away changes nothing and gets no mask.
  const g = grid(1000, 1000, 4, 4, () => 50);
  assert.deepEqual(Array.from(mergeStrongest(g, [a, b]).values), Array(16).fill(50));
  assert.equal(maskUnder(a, g), null);
});

test("the path type follows the pixel that wins a merge", () => {
  // c: -60 dBm by LOS everywhere except row 0 (nodata); d over it: -70
  // dBm by NLOS. Where c is stronger the merged pixel is LOS; d's own
  // pixels outside c, and under c's nodata row, stay NLOS.
  const c = grid(0, 10, 4, 4, (i, j) => (j === 0 ? 255 : 60));
  c.paths = Uint8Array.from(c.values, (v) => (v === 255 ? 255 : PATH_LOS));
  const d = grid(2, 8, 4, 4, () => 70);
  d.paths = new Uint8Array(16).fill(PATH_NLOS);
  const m = mergeStrongest(d, [c]);
  assert.equal(m.values[0], 60);
  assert.equal(m.paths[0], PATH_LOS, "the stronger LOS pixel brings its path type");
  assert.equal(m.values[3], 70);
  assert.equal(m.paths[3], PATH_NLOS, "d's own pixel keeps NLOS");
  // An earlier one-band patch (NLOS off) counts as line of sight.
  const e = grid(0, 10, 4, 4, () => 50);
  const m2 = mergeStrongest(d, [e]);
  assert.equal(m2.paths[0], PATH_LOS);
  assert.equal(m2.paths[3], PATH_NLOS);
  // A new one-band patch over a two-band one gets a synthesised band:
  // its covered pixels LOS, its nodata pixels 255 unless an earlier
  // patch fills them.
  const f = grid(2, 8, 4, 4, (i) => (i === 0 ? 255 : 65));
  const m3 = mergeStrongest(f, [d]);
  assert.equal(m3.values[0], 70, "nodata takes d's value");
  assert.equal(m3.paths[0], PATH_NLOS, "and d's path type");
  assert.equal(m3.paths[1], PATH_LOS);
  assert.equal(m3.paths[3], PATH_LOS);
});

test("decodeRaster georeferences a live reply", async (t) => {
  const base = process.env.RFREVEALD_URL || "http://127.0.0.1:8080";
  let reply;
  try {
    const req = buildRequest({ lat: 33.9137, lon: -98.4934, towers: TOWERS, radius: 100, aboveGround: 5, aboveSurface: 2, minSignalDbm: -100 });
    const res = await fetch(`${base}/api/v1/patch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    reply = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(reply));
  } catch (e) {
    t.skip(`service not reachable at ${base}: ${e.message}`);
    return;
  }
  assert.equal(reply.raster.crs, "EPSG:3857");
  const d = await decodeRaster(reply.raster);
  assert.equal(d.width, 201);
  assert.equal(d.height, 201);
  assert.equal(d.values.length, 201 * 201);
  // The 201 m patch is centred on the request point (Mercator is
  // conformal, so the midpoint of the bounds is the centre pixel's centre
  // in longitude; in latitude it is within a few millimetres of it).
  const midLat = (d.bounds.north + d.bounds.south) / 2;
  const midLon = (d.bounds.east + d.bounds.west) / 2;
  assert.ok(Math.abs(midLat - 33.9137) < 1e-6, `lat ${midLat}`);
  assert.ok(Math.abs(midLon + 98.4934) < 1e-9, `lon ${midLon}`);
  const heightM = (d.bounds.north - d.bounds.south) * 111_195;
  assert.ok(heightM > 198 && heightM < 204, `height ${heightM} m`);
  assert.ok(d.values.some((v) => v !== 255), "some covered cells");
  // NLOS on by default: a second band with the path type of each pixel.
  assert.equal(reply.raster.bands, 2);
  assert.equal(reply.enable_los, 1);
  assert.equal(reply.enable_nlos, 1);
  assert.equal(reply.rxclearance, 3, "the service default clearance is echoed in metres");
  assert.ok(d.paths && d.paths.length === d.values.length, "a path band of the same size");
  assert.ok(d.paths.some((p) => p === PATH_LOS) && d.paths.some((p) => p === PATH_NLOS), "both path types occur in the sample patch");
  for (let k = 0; k < d.values.length; k++) {
    assert.ok((d.values[k] === 255) === (d.paths[k] === 255), `nodata agrees between the bands at ${k}`);
  }
  const wt = reply.towers.find((t) => t.id === "water-tower").radios[1];
  assert.ok(wt.nlos && wt.nlos.coverage_pct >= wt.los.coverage_pct, "the nlos figures count the LOS cells too");
  // A LOS-only request has one band and no nlos figures.
  const losReq = buildRequest({ lat: 33.9137, lon: -98.4934, towers: TOWERS, radius: 20, aboveGround: 5, aboveSurface: 2, minSignalDbm: -100, enableNLOS: false });
  const losRes = await fetch(`${base}/api/v1/patch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(losReq) });
  const losReply = await losRes.json();
  assert.equal(losReply.raster.bands, 1);
  const dl = await decodeRaster(losReply.raster);
  assert.equal(dl.paths, null);
  assert.ok(losReply.towers.every((t) => t.radios.every((r) => r.skipped || r.nlos === null)));
  assert.ok(Math.abs(d.mercator.dx - 1.2045) < 0.002 && d.mercator.dy === -d.mercator.dx, JSON.stringify(d.mercator));
  assert.equal(reply.atmosphere?.mode, "none");
  // The 60 GHz tower is 2 km from this point at most, so it is evaluated,
  // line of sight only: it is above the NLOS frequency ceiling.
  const t60 = reply.towers.find((t) => t.id === "downtown-60");
  assert.ok(t60 && t60.radios.every((r) => !r.skipped), JSON.stringify(t60));
  assert.ok(t60.radios.every((r) => r.nlos === null && r.nlos_skipped === "above_nlos_frequency"), JSON.stringify(t60.radios[0]));
});

test("a wet request carries losses in the live reply", async (t) => {
  const base = process.env.RFREVEALD_URL || "http://127.0.0.1:8080";
  let reply;
  try {
    const req = buildRequest({ lat: 33.9137, lon: -98.4934, towers: TOWERS, radius: 50, aboveGround: 5, aboveSurface: 2, minSignalDbm: -100, atmosphere: "wet" });
    const res = await fetch(`${base}/api/v1/patch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    reply = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(reply));
  } catch (e) {
    t.skip(`service not reachable at ${base} or without the maps: ${e.message}`);
    return;
  }
  assert.equal(reply.atmosphere.mode, "wet");
  assert.equal(reply.atmosphere.rain_percentile_pct, 5);
  const t60 = reply.towers.find((t) => t.id === "downtown-60");
  const l = t60.radios[0].loss;
  assert.ok(l && l.gas_db_per_km > 10 && l.gas_db_per_km < 20, `60 GHz oxygen loss ${JSON.stringify(l)}`);
  assert.ok(l.rain_rate_mm_h > 5 && l.rain_rate_mm_h < 20, `wet rain rate ${l.rain_rate_mm_h}`);
});
