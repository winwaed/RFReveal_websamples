// node --test test/  (Node 18 or later)
import { test } from "node:test";
import assert from "node:assert/strict";

import { binAt, buildProfileRequest, chartLayout, chartSVG, covers, fetchWindow, lineAt, niceTicks, panRange, profileCaption, profileTitle, readout, viewOf, viewStep, zoomRange } from "../profile.js";

const radios = [{ id: "a1", name: "SW", antenna: "x", frequency_ghz: 5.8, azimuth_deg: 240, height: 45, tx_power_dbm: 18 }];
const pointRequest = {
  units: "metric",
  location: { lat: 33.91, lon: -98.49 },
  min_signal_dbm: -80,
  rx_height: { above_ground: 5, above_surface: 2 },
  towers: [{ id: "a", name: "A", lat: 33.92, lon: -98.5, radios }],
  options: { atmosphere: "dry" },
  enable_los: 1,
  enable_nlos: 1,
  rxclearance: 4,
};

test("buildProfileRequest: the point request's settings, one tower and radio, one height", () => {
  const req = buildProfileRequest({ request: pointRequest, towerId: "a", radioId: "a1", rxHeight: "above_surface", samples: 300, range: [12.3, 99.2] });
  assert.equal(req.units, "metric");
  assert.deepEqual(req.location, pointRequest.location);
  assert.equal(req.min_signal_dbm, -80);
  assert.deepEqual(req.rx_height, { above_surface: 2 });
  assert.deepEqual(req.tower, { id: "a", name: "A", lat: 33.92, lon: -98.5, radio: radios[0] });
  assert.deepEqual(req.options, { atmosphere: "dry" });
  assert.equal(req.enable_los, 1);
  assert.equal(req.enable_nlos, 1);
  assert.equal(req.rxclearance, 4);
  assert.equal(req.samples, 300);
  assert.deepEqual(req.range, [12, 100]);
  assert.equal(req.towers, undefined);
  // A height the point request lacks falls back to the one it has; no
  // samples or range when not given; no options when the point had none.
  const bare = { ...pointRequest, rx_height: { above_surface: 2 }, options: undefined, rxclearance: undefined };
  const r2 = buildProfileRequest({ request: bare, towerId: "a", radioId: "a1", rxHeight: "above_ground" });
  assert.deepEqual(r2.rx_height, { above_surface: 2 });
  assert.equal(r2.samples, undefined);
  assert.equal(r2.range, undefined);
  assert.equal("options" in r2, false);
  assert.equal("rxclearance" in r2, false);
  assert.throws(() => buildProfileRequest({ request: pointRequest, towerId: "zz", radioId: "a1", rxHeight: "above_ground" }), /no tower zz/);
  assert.throws(() => buildProfileRequest({ request: pointRequest, towerId: "a", radioId: "a9", rxHeight: "above_ground" }), /no radio a9/);
});

// A 100 m NLOS path: flat ground at 300 m, a 20 m building over bins 5
// and 6, trees over bin 8, no data in bin 2.
const reply = {
  units: "metric", status: "ok", skipped: null, nlos_skipped: null,
  tower: { id: "a", name: "A", radio: "a1", radio_name: "SW" },
  distance: 100, frequency_mhz: 5800, k_factor: 1.3333, fresnel_clearance: 0.6,
  ap: { ground: 300, surface: 300, antenna: 330, height: 30, apclearance: 10 },
  rx: { ground: 300, surface: 300, vegetation: false, antenna: 305, rx_height: "above_ground", height: 5, rxclearance: 3 },
  link: { path: "nlos", covered: true, signal_dbm: -71, free_space_dbm: -58.2, ap_gain_dbi: -4.1, excess_loss_db: 12.7, diffraction_db: 9.4, vegetation_db: 3.3, vegetation_m: 11, elevation_deg: 14, reason: null },
  tightest: { distance: 60, surface: 320, bulge: 0, line: 315, clearance: -5, r1: 1.1, fresnel: -4.5 },
  bullington: { case: "point", variant: "solid", from_ap: { distance: 60, height: 320 }, from_rx: { distance: 60, height: 320 }, edge: { distance: 60, height: 320, v: 2.1 } },
  bins: {
    step: 10, range: [0, 99], count: 10,
    distance: [4.5, 14.5, 24.5, 34.5, 44.5, 54.5, 64.5, 74.5, 84.5, 94.5],
    ground: [300, 300, null, 300, 300, 300, 300, 300, 300, 300],
    surface: [300, 300, null, 300, 300, 320, 320, 300, 312, 300],
    peak: [0, 10, null, 30, 40, 55, 60, 70, 80, 90],
    veg: [0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0],
    bulge: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    fresnel: [0.5, 0.8, 1, 1.1, 1.1, 1.1, 1.1, 1, 0.8, 0.5],
  },
};

test("chartLayout: the x domain is the path, the y domain takes in terrain, antennas and the zone", () => {
  const L = chartLayout(reply, { width: 500, height: 200 });
  assert.equal(L.x0, 0);
  assert.equal(L.x1, 100, "a range reaching the end extends to the receiver");
  assert.ok(L.ymin < 300 && L.ymin > 290, `ymin ${L.ymin}`);
  assert.ok(L.ymax > 331 && L.ymax < 340, `ymax ${L.ymax}`);
  assert.equal(L.x(0), L.pad.left);
  assert.ok(Math.abs(L.x(100) - (500 - L.pad.right)) < 1e-9);
  assert.ok(Math.abs(L.invX(L.x(37)) - 37) < 1e-9);
  assert.ok(L.y(L.ymax) === L.pad.top && L.y(L.ymin) === 200 - L.pad.bottom);
  // A zoomed range keeps its own domain.
  const zoomed = { ...reply, bins: { ...reply.bins, range: [40, 70] } };
  const Z = chartLayout(zoomed, { width: 500, height: 200 });
  assert.equal(Z.x0, 40);
  assert.equal(Z.x1, 70);
  assert.equal(chartLayout({ ...reply, bins: null }, { width: 500, height: 200 }), null);
  const line = lineAt(reply);
  assert.equal(line(0), 330);
  assert.equal(line(100), 305);
  assert.equal(lineAt({ ...reply, rx: { ...reply.rx, antenna: null } }), null);
});

test("chartSVG: ground, clutter and vegetation runs, the zone, the line, the construction", () => {
  const L = chartLayout(reply, { width: 500, height: 200 });
  const svg = chartSVG(reply, L);
  assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"));
  // The no-data bin splits the ground into two polygons; the clutter is
  // one grey polygon over every bin with data and one green run.
  assert.equal((svg.match(/class="ground"/g) || []).length, 2);
  assert.equal((svg.match(/class="surface"/g) || []).length, 2);
  assert.equal((svg.match(/class="veg"/g) || []).length, 1);
  assert.equal((svg.match(/class="zone"/g) || []).length, 2);
  assert.ok(svg.includes('class="fresnel"') && (svg.match(/class="fresnel-clear"/g) || []).length === 2);
  assert.ok(svg.includes('class="ray"'));
  assert.equal((svg.match(/class="tangent"/g) || []).length, 2);
  assert.ok(svg.includes("v = 2.1") && svg.includes("-4.5 F1 at 60 m"));
  assert.equal((svg.match(/class="antenna"/g) || []).length, 2);
  assert.ok(svg.includes("m from the AP"));
  // The ray runs from the AP antenna to the receiver antenna.
  const ray = svg.match(/class="ray" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
  assert.ok(ray);
  assert.ok(Math.abs(+ray[1] - L.x(0)) < 0.1 && Math.abs(+ray[2] - L.y(330)) < 0.1 && Math.abs(+ray[3] - L.x(100)) < 0.1 && Math.abs(+ray[4] - L.y(305)) < 0.1);
  // A skipped reply with no bins is not drawn; an LOS reply has no construction.
  const los = { ...reply, link: { ...reply.link, path: "los" }, bullington: null };
  const s2 = chartSVG(los, L);
  assert.ok(!s2.includes('class="tangent"') && !s2.includes('class="edge"'));
});

test("niceTicks and zoomRange", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(290, 340, 4), [290, 300, 310, 320, 330, 340]);
  assert.deepEqual(niceTicks(0, 650, 6), [0, 100, 200, 300, 400, 500, 600]);
  assert.deepEqual(niceTicks(5, 5, 3), [5]);
  // Zoom in about the middle, then about the left end, then out past the path.
  assert.deepEqual(zoomRange([0, 100], 100, 0.5, 2), [25, 75]);
  assert.deepEqual(zoomRange([0, 100], 100, 0, 2), [0, 50]);
  assert.deepEqual(zoomRange([25, 75], 100, 0.5, 0.5), [0, 100]);
  assert.equal(zoomRange([0, 100], 100, 0.5, 0.5), null, "already the whole path");
  // The span never drops below the minimum and the range stays inside the path.
  assert.deepEqual(zoomRange([40, 60], 100, 0.5, 4), [40, 60]);
  assert.deepEqual(zoomRange([80, 100], 100, 1, 0.5), [60, 100]);
});

test("panRange: shifts a zoomed range along the path and stops at the ends", () => {
  assert.deepEqual(panRange([20, 40], 100, 10), [30, 50]);
  assert.deepEqual(panRange([20, 40], 100, -10), [10, 30]);
  assert.deepEqual(panRange([20, 40], 100, -30), [0, 20], "clamped at the AP");
  assert.deepEqual(panRange([20, 40], 100, 70), [80, 100], "clamped at the receiver");
  assert.equal(panRange([0, 20], 100, -5), null, "already at the AP");
  assert.equal(panRange([80, 100], 100, 5), null, "already at the receiver");
  assert.equal(panRange([0, 100], 100, 5), null, "the whole path does not pan");
  assert.equal(panRange([20, 40], 100, 0), null);
});

test("captions and the hover readout", () => {
  assert.equal(profileTitle(reply), "A / SW → point, receiver 5 m above ground");
  const cap = profileCaption(reply);
  assert.ok(cap.startsWith("NLOS -71 dBm · free space -58.2 dBm · excess loss 12.7 dB (diffraction 9.4, vegetation 3.3 over 11 m of canopy)"), cap);
  assert.ok(cap.includes("tightest -4.5 F1 at 60 m (-5 m clear)") && cap.includes("100 m, 5.8 GHz, k = 4/3"), cap);
  assert.equal(profileCaption({ ...reply, skipped: "beyond_range" }), "Skipped (beyond range).");
  const blocked = profileCaption({ ...reply, link: { path: null, reason: "blocked", free_space_dbm: -58.2 }, tightest: null, bullington: null });
  assert.ok(blocked.startsWith("no path · blocked · free space -58.2 dBm · 100 m"), blocked);
  const L = chartLayout(reply, { width: 500, height: 200 });
  assert.equal(binAt(reply, L, L.x(63)), 6);
  assert.equal(binAt(reply, L, L.x(99)), 9);
  assert.equal(binAt(reply, L, 2), -1);
  assert.equal(readout(reply, 6), "64.5 m · ground 300 · surface 320 · clearance -6.1 m (-5.57 F1) · r1 1.1, bulge 0");
  assert.equal(readout(reply, 8), "84.5 m · ground 300 · surface 312 (trees) · clearance -3.1 m (-3.91 F1) · r1 0.8, bulge 0");
  assert.equal(readout(reply, 2), "24.5 m · r1 1, bulge 0");
});

test("viewStep, covers and fetchWindow: the page asks again only for finer or farther bins", () => {
  assert.equal(viewStep(6186, 616), 11);
  assert.equal(viewStep(100, 616), 1);
  // The fixture holds the whole 100 m path at 10 m bins on a 500 px plot.
  assert.equal(covers(reply, null, 500), false, "the whole path at 500 px wants 1 m bins");
  assert.equal(covers(reply, null, 8), true, "at 8 px 13 m bins would do");
  assert.equal(covers(reply, [20, 40], 2), true, "a 20 m view on 2 px needs 10 m bins");
  assert.equal(covers(reply, [20, 40], 3), false);
  const partial = { ...reply, bins: { ...reply.bins, range: [30, 69] } };
  assert.equal(covers(partial, [40, 60], 2), true);
  assert.equal(covers(partial, [20, 60], 2), false, "the view runs past the window");
  assert.equal(covers({ ...reply, bins: null }, null, 500), false);
  assert.deepEqual(fetchWindow(null, 6186, 616), { samples: 2000 }, "the whole path at the most bins the service gives");
});

test("fetchWindow: a window around the view at the step it needs, inside the path", () => {
  // 1000 m at 616 px needs 2 m bins: a 3998 m window centred on the view.
  let w = fetchWindow([2500, 3500], 6186, 616);
  assert.deepEqual(w, { range: [1001, 4999], samples: 2000 });
  assert.ok(Math.ceil((w.range[1] - w.range[0]) / w.samples) <= 2, "the service's step stays within the view's");
  // Near the AP the window starts at 0; near the receiver it ends at the path.
  assert.deepEqual(fetchWindow([100, 1100], 6186, 616), { range: [0, 3998], samples: 2000 });
  assert.deepEqual(fetchWindow([5000, 6000], 6186, 616), { range: [2188, 6186], samples: 2000 });
  // A view at 1 m bins gets a 1998 m window; a long view gets the whole path.
  assert.deepEqual(fetchWindow([3000, 3300], 6186, 616), { range: [2151, 4149], samples: 1998 });
  assert.deepEqual(fetchWindow([1000, 4000], 6186, 616), { samples: 2000 }, "3000 m at 616 px needs 5 m bins: 9998 m covers the path");
  assert.deepEqual(fetchWindow([20, 40], 100, 500), { samples: 2000 });
});

test("viewOf: the bins overlapping the view plus one each side, range set to the view", () => {
  const v = viewOf(reply, [32, 58]);
  assert.deepEqual(v.bins.range, [32, 58]);
  // Bins 3..5 overlap, plus 2 and 6.
  assert.equal(v.bins.count, 5);
  assert.deepEqual(v.bins.distance, [24.5, 34.5, 44.5, 54.5, 64.5]);
  assert.deepEqual(v.bins.surface, [null, 300, 300, 320, 320]);
  assert.equal(v.bins.step, 10);
  assert.equal(v.distance, 100, "the rest of the reply is kept");
  assert.equal(reply.bins.count, 10, "the held reply is untouched");
  assert.equal(viewOf(reply, null), reply);
  // The ends clamp to the held bins; the layout's domain is the view.
  const e = viewOf(reply, [0, 12]);
  assert.deepEqual(e.bins.distance, [4.5, 14.5, 24.5]);
  const L = chartLayout(e, { width: 500, height: 200 });
  assert.equal(L.x0, 0);
  assert.equal(L.x1, 12);
});
