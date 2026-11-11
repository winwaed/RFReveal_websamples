// The buildings mode: selecting the footprints near the ticked towers,
// batching them for the building endpoint, building the requests, and
// colouring the results. Pure functions apart from the two fetches, so
// they are testable in Node (see test/building.test.js).
//
// buildings.json (made by tools/compact-buildings.py from OpenStreetMap)
// is an array of { id, name?, building, levels?, rings } where rings is
// [[[lon, lat], ...], ...]: the first ring the outer boundary, the rest
// holes, every ring closed (last position repeats the first).

import { fetchJSON, pathFlags, signalColor } from "./patch.js";

// loadBuildings fetches the file and checks its shape.
export async function loadBuildings(url = "buildings.json") {
  const res = await fetch(url, { cache: "reload" });
  if (!res.ok) throw new Error(`cannot load ${url}: ${res.status} ${res.statusText}`);
  let doc;
  try {
    doc = await res.json();
  } catch (e) {
    throw new Error(`${url} is not valid JSON: ${e.message}`);
  }
  return checkBuildings(doc, url);
}

// checkBuildings validates the array and adds each building's centroid.
export function checkBuildings(doc, url = "buildings.json") {
  if (!Array.isArray(doc)) throw new Error(`${url} must be a JSON array of buildings`);
  const ids = new Set();
  return doc.map((b, i) => {
    if (!b || typeof b.id !== "string" || !Array.isArray(b.rings) || b.rings.length === 0) {
      throw new Error(`${url}[${i}] needs an id and rings`);
    }
    if (ids.has(b.id)) throw new Error(`${url}[${i}]: duplicate id ${b.id}`);
    ids.add(b.id);
    const outer = b.rings[0];
    if (!Array.isArray(outer) || outer.length < 4) throw new Error(`${url}[${i}] (${b.id}): the outer ring needs at least 4 positions`);
    return { ...b, centroid: ringCentroid(outer) };
  });
}

// ringCentroid is the mean of a ring's distinct vertices: good enough to
// decide which buildings are near a tower and where to put a popup.
export function ringCentroid(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

// distanceM is the ground distance between two points in metres
// (equirectangular approximation, fine over a few kilometres).
const EARTH_R = 6371000;
export function distanceM(a, b) {
  const toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return EARTH_R * Math.hypot(x, y);
}

// selectWithin returns the buildings whose centroid lies within radiusM
// of any of the towers, in file order.
export function selectWithin(buildings, towers, radiusM) {
  return buildings.filter((b) => towers.some((t) => distanceM(b.centroid, { lat: t.lat, lon: t.lon }) <= radiusM));
}

// mercator projects to EPSG:3857 metres, for the batching grid.
const MERC_R = 6378137;
export function mercator({ lat, lon }) {
  return { x: (MERC_R * lon * Math.PI) / 180, y: MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) };
}

// batches groups the buildings by a bucketM grid square of their centroid
// (in Web Mercator metres), orders the squares along a Hilbert curve and
// cuts the sequence into batches of at most max buildings, so each
// request to the service holds neighbours: the server clusters each batch
// in its own zone, and compact batches make full clusters. The curve
// keeps consecutive squares adjacent, so every batch covers a compact
// area and the batches take similar times; row-by-row order made the
// first batch a thin band of scattered buildings across the whole width.
export function batches(buildings, { max = 300, bucketM = 200 } = {}) {
  if (buildings.length === 0) return [];
  const keyed = buildings.map((b) => {
    const { x, y } = mercator(b.centroid);
    return { b, i: Math.floor(x / bucketM), j: Math.floor(y / bucketM) };
  });
  const i0 = Math.min(...keyed.map((p) => p.i));
  const j0 = Math.min(...keyed.map((p) => p.j));
  const extent = Math.max(...keyed.map((p) => Math.max(p.i - i0, p.j - j0))) + 1;
  let n = 1;
  while (n < extent) n *= 2;
  for (const p of keyed) p.d = hilbertIndex(n, p.i - i0, p.j - j0);
  keyed.sort((p, q) => p.d - q.d);
  const out = [];
  for (let k = 0; k < keyed.length; k += max) out.push(keyed.slice(k, k + max).map((p) => p.b));
  return out;
}

// hilbertIndex is the distance along the Hilbert curve filling the n x n
// grid (n a power of two) of the cell (x, y), 0 <= x, y < n. Cells at
// consecutive distances are side by side, and any run of 4^k consecutive
// distances starting at a multiple of 4^k is a 2^k x 2^k block.
export function hilbertIndex(n, x, y) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

// buildBuildingRequest assembles a POST /api/v1/building body (metric,
// receiver above the roof only: a receiver above the ground is inside the
// building on all but low structures, see docs/building-plan.md 1.1).
// The path flags and receiver clearance are as in the patch request
// (patch.js pathFlags; docs/building-plan.md 1.3). The service's cell
// raster option (docs/building-api.md 4.5) is not requested: the sample
// shows the figures only.
export function buildBuildingRequest({ buildings, towers, aboveSurface, minSignalDbm, signalRank = 3, atmosphere = "none", detail = "radios", enableLOS = true, enableNLOS = true, rxClearance = 0 }) {
  const req = {
    units: "metric",
    min_signal_dbm: minSignalDbm,
    signal_rank: signalRank,
    rx_height: { above_surface: aboveSurface },
    detail,
    buildings: buildings.map((b) => ({ id: b.id, name: b.name || "", geometry: { type: "Polygon", coordinates: b.rings } })),
    towers: towers.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, radios: t.radios })),
  };
  if (atmosphere && atmosphere !== "none") req.options = { atmosphere };
  Object.assign(req, pathFlags({ enableLOS, enableNLOS, rxClearance }));
  return req;
}

// fetchBuildings posts one batch and returns the decoded reply.
export function fetchBuildings(base, request, opts) {
  return fetchJSON(base, "/api/v1/building", request, opts);
}

// toFeature is the building as a GeoJSON Feature for the map's Data layer.
export function toFeature(b) {
  return { type: "Feature", id: b.id, properties: { id: b.id }, geometry: { type: "Polygon", coordinates: b.rings } };
}

// coverageColor maps a coverage percentage onto the red (none) to green
// (all) ramp the signal colours use, so the two legends read alike.
// Returns [r, g, b]; 0 % is grey.
export function coverageColor(pct) {
  if (!(pct > 0)) return [158, 158, 158];
  const t = Math.min(1, Math.max(0, pct / 100));
  return hslToRgb(120 * t, 0.85, 0.42);
}

// buildingColor picks the fill for a building from its result: by
// combined coverage, or by the combined rank signal (grey when null).
export function buildingColor(result, { by = "coverage", weak = -100 } = {}) {
  if (!result || result.skipped) return [120, 120, 120];
  const c = result.combined || {};
  if (by === "signal") return c.signal_dbm == null ? [158, 158, 158] : signalColor(c.signal_dbm, { weak });
  return coverageColor(c.coverage_pct);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

// bestRadiosPerTower reduces a building's radios (detail: radios) to the
// best covering radio of each tower: most coverage, then strongest.
export function bestRadiosPerTower(building, reply) {
  const rows = [];
  for (const t of reply.towers) {
    let best = null;
    for (const r of building.radios || []) {
      if (r.tower !== t.id || r.skipped || !(r.coverage_pct > 0)) continue;
      if (!best || r.coverage_pct > best.coverage_pct || (r.coverage_pct === best.coverage_pct && (r.signal_dbm ?? -Infinity) > (best.signal_dbm ?? -Infinity))) best = r;
    }
    if (best) {
      const radio = t.radios.find((x) => x.id === best.radio);
      rows.push({ tower: t, radio: { ...best, name: radio?.name || best.radio } });
    }
  }
  return rows;
}
