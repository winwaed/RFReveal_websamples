// Talking to the RF Reveal service and turning its raster into something a map
// can show. Expects the vendored geotiff.js as the global GeoTIFF. Pure
// functions apart from fetchPatch, so they are testable in Node (see test/).

// buildRequest assembles a POST /api/v1/patch body for a click at (lat, lon)
// using the enabled towers. Lengths are metric: metres for heights and the
// radius, kilometres for ranges.
// atmosphere is "none" (the default, free-space loss only), "dry" or
// "wet" (gas loss plus the rain rate exceeded for 95 % or 5 % of rainy
// time at each tower, see docs/patch-api.md 4.9); none omits options.
// enableLOS and enableNLOS choose which path types count (docs/patch-api.md
// 4.10; the service wants the integers 0 and 1, not booleans), and
// rxClearance (metres) is the receiver clearance of the NLOS profile,
// omitted when not positive so the service default applies.
export function buildRequest({ lat, lon, towers, radius, aboveGround, aboveSurface, minSignalDbm, atmosphere = "none", enableLOS = true, enableNLOS = true, rxClearance = 0 }) {
  const rx = {};
  if (aboveGround > 0) rx.above_ground = aboveGround;
  if (aboveSurface > 0) rx.above_surface = aboveSurface;
  const req = {
    units: "metric",
    location: { lat, lon },
    radius,
    min_signal_dbm: minSignalDbm,
    rx_height: rx,
    towers: towers.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, radios: t.radios })),
  };
  if (atmosphere && atmosphere !== "none") req.options = { atmosphere };
  Object.assign(req, pathFlags({ enableLOS, enableNLOS, rxClearance }));
  return req;
}

// pathFlags is the request's path-type selection, shared by the patch and
// building requests: enable_los and enable_nlos as 0/1 integers and the
// receiver clearance when given. Both flags off is refused by the service
// (a 400), so the page checks flagsValid first.
export function pathFlags({ enableLOS = true, enableNLOS = true, rxClearance = 0 }) {
  const out = { enable_los: enableLOS ? 1 : 0, enable_nlos: enableNLOS ? 1 : 0 };
  if (rxClearance > 0) out.rxclearance = rxClearance;
  return out;
}

// flagsValid is false when neither path type is selected.
export function flagsValid({ enableLOS, enableNLOS }) {
  return Boolean(enableLOS || enableNLOS);
}

// fetchPatch posts the request to base (e.g. http://localhost:8080) and
// returns the decoded reply. Errors carry the service's code and message.
export function fetchPatch(base, request, opts) {
  return fetchJSON(base, "/api/v1/patch", request, opts);
}

// fetchJSON posts a JSON body to a route of the service and returns the
// decoded reply. Errors carry the service's code and message. trace, when
// given, is called with the exchange record as the request goes out
// (status null) and again when the reply is in or the request failed;
// the debug pane shows it (debug.js).
export async function fetchJSON(base, path, request, { signal, trace, method = "POST" } = {}) {
  const url = `${base}${path}`;
  const payload = method === "GET" ? "" : JSON.stringify(request);
  const started = performance.now();
  const x = { method, url, request, requestBytes: payload.length, status: null, reply: null, bytes: null, ms: null, error: null };
  trace?.(x);
  let res;
  try {
    res = await fetch(url, method === "GET" ? { method, signal } : {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal,
    });
  } catch (e) {
    x.ms = performance.now() - started;
    x.error = e.name === "AbortError" ? "aborted by the page" : e.message;
    trace?.(x);
    if (e.name === "AbortError") throw e;
    throw new Error(`cannot reach ${base}: ${e.message} (is the service running, and started with -cors-origin for this page?)`);
  }
  let body = null;
  try {
    const text = await res.text();
    x.bytes = text.length;
    body = JSON.parse(text);
  } catch {
    /* non-JSON body: fall through to the status text */
  }
  x.status = res.status;
  x.reply = body;
  x.ms = performance.now() - started;
  trace?.(x);
  if (!res.ok) {
    const msg = body?.error?.message || `${res.status} ${res.statusText}`;
    const code = body?.error?.code || "http_error";
    throw new Error(`${code}: ${msg}`);
  }
  return body;
}

// mercatorToLatLon converts EPSG:3857 metres to WGS 84 degrees.
const EARTH_R = 6378137;
export function mercatorToLatLon(x, y) {
  const lon = (x / EARTH_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lon };
}

// decodeRaster decodes the reply's base64 GeoTIFF into its byte values and
// the WGS 84 bounds of the image. The service writes the raster in Web
// Mercator (EPSG:3857), the projection Google Maps draws in, so the image
// is axis-aligned on the map and its bounds follow from the two corners.
// With NLOS on the file has a second band, the path type of each pixel
// (1 line of sight, 2 non-line-of-sight, 255 nodata; docs/patch-api.md
// 4.8), returned as `paths`; null for a one-band raster.
export async function decodeRaster(raster) {
  if (!raster || raster.format !== "geotiff" || raster.encoding !== "base64") {
    throw new Error("unexpected raster format");
  }
  const bin = atob(raster.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const tiff = await GeoTIFF.fromArrayBuffer(bytes.buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [values, pathBand] = await image.readRasters();
  const toBytes = (a) => (a instanceof Uint8Array ? a : Uint8Array.from(a));

  const epsg = image.getGeoKeys().ProjectedCSTypeGeoKey;
  if (epsg !== 3857) throw new Error(`raster is in EPSG:${epsg}, expected 3857`);
  const [ox, oy] = image.getOrigin();
  const [dx, dy] = image.getResolution(); // dy is negative for north-up
  const nw = mercatorToLatLon(ox, oy);
  const se = mercatorToLatLon(ox + width * dx, oy + height * dy);
  return {
    width,
    height,
    nodata: raster.nodata ?? 255,
    values: toBytes(values),
    paths: pathBand ? toBytes(pathBand) : null,
    bounds: { west: nw.lon, east: se.lon, south: se.lat, north: nw.lat },
    mercator: { x0: ox, y0: oy, dx, dy }, // EPSG:3857 origin (upper-left corner) and pixel size
  };
}

// --- combining several patches on one map ---
//
// Each patch is drawn as its own image, so where two overlap the map
// would otherwise stack two translucent layers and the overlap would look
// stronger than either. Instead every pixel shows the strongest signal of
// all the patches covering it, drawn once: a new patch takes the strongest
// value of itself and every earlier patch at each of its pixels (merged),
// and the earlier patches stop drawing the pixels that lie under it
// (mask). One patch at -70 dBm and two overlapping patches at -70 dBm
// therefore look the same.

// mercatorBounds is the patch's extent in EPSG:3857 metres.
export function mercatorBounds(d) {
  const { x0, y0, dx, dy } = d.mercator;
  return { xmin: x0, xmax: x0 + d.width * dx, ymax: y0, ymin: y0 + d.height * dy };
}

function overlaps(a, b) {
  const p = mercatorBounds(a);
  const q = mercatorBounds(b);
  return p.xmin < q.xmax && q.xmin < p.xmax && p.ymin < q.ymax && q.ymin < p.ymax;
}

// pixelIndex is the index of d's pixel containing the Mercator point, or
// -1 outside the patch.
export function pixelIndex(d, x, y) {
  const { x0, y0, dx, dy } = d.mercator;
  const i = Math.floor((x - x0) / dx);
  const j = Math.floor((y - y0) / dy);
  if (i < 0 || j < 0 || i >= d.width || j >= d.height) return -1;
  return j * d.width + i;
}

// mergeStrongest returns copies of d's values and path types where every
// pixel holds the strongest signal (the smallest negated dBm) of d and
// the given earlier patches (their merged values when they have them),
// the path type following the pixel that won. Patches that do not
// overlap d are skipped. `paths` is null when no patch involved has a
// path band.
export function mergeStrongest(d, others) {
  const values = Uint8Array.from(d.values);
  const near = others.filter((o) => o !== d && overlaps(d, o));
  const anyPaths = d.paths || near.some((o) => o.paths);
  const paths = anyPaths ? pathsOf(d, values.length) : null;
  if (near.length === 0) return { values, paths };
  const nodata = d.nodata;
  const { x0, y0, dx, dy } = d.mercator;
  for (let j = 0; j < d.height; j++) {
    const y = y0 + (j + 0.5) * dy;
    for (let i = 0; i < d.width; i++) {
      const x = x0 + (i + 0.5) * dx;
      const k = j * d.width + i;
      let v = values[k];
      let p = paths ? paths[k] : 0;
      for (const o of near) {
        const idx = pixelIndex(o, x, y);
        if (idx < 0) continue;
        const ov = (o.merged || o.values)[idx];
        if (ov === o.nodata) continue;
        if (v === nodata || ov < v) {
          v = ov;
          p = o.mergedPaths?.[idx] ?? o.paths?.[idx] ?? PATH_LOS;
        }
      }
      values[k] = v;
      if (paths) paths[k] = v === nodata ? 255 : p;
    }
  }
  return { values, paths };
}

export const PATH_LOS = 1;
export const PATH_NLOS = 2;

// pathsOf is a patch's path band as a fresh array, or, for a patch drawn
// without one (NLOS off), every covered pixel as line of sight.
function pathsOf(d, n) {
  if (d.paths) return Uint8Array.from(d.paths);
  const out = new Uint8Array(n).fill(255);
  for (let k = 0; k < n; k++) if (d.values[k] !== d.nodata) out[k] = PATH_LOS;
  return out;
}

// maskUnder returns d's draw mask (1 draw, 0 hide) with the pixels whose
// centres lie inside newer's extent hidden, starting from d's current mask
// when it has one. Returns null when nothing changes.
export function maskUnder(d, newer) {
  if (!overlaps(d, newer)) return null;
  const mask = d.mask ? Uint8Array.from(d.mask) : new Uint8Array(d.width * d.height).fill(1);
  const { x0, y0, dx, dy } = d.mercator;
  const b = mercatorBounds(newer);
  for (let j = 0; j < d.height; j++) {
    const y = y0 + (j + 0.5) * dy;
    if (y <= b.ymin || y >= b.ymax) continue;
    for (let i = 0; i < d.width; i++) {
      const x = x0 + (i + 0.5) * dx;
      if (x > b.xmin && x < b.xmax) mask[j * d.width + i] = 0;
    }
  }
  return mask;
}

// signalColor maps a received level in dBm onto a green (strong) to red
// (at the threshold) ramp. Returns [r, g, b].
export function signalColor(dbm, { strong = -45, weak = -100 } = {}) {
  let t = (strong - dbm) / (strong - weak); // 0 strong .. 1 weak
  t = Math.min(1, Math.max(0, t));
  return hslToRgb(120 * (1 - t), 0.9, 0.45); // hue 120 green .. 0 red
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

// rasterToRGBA paints the byte values (negated dBm; nodata transparent) into
// an RGBA buffer, enlarged `scale` times with nearest-neighbour sampling so
// the browser does not blur the cells when it stretches the image. It
// draws the merged values and honours the mask when the patch has them.
// Pixels reached by a non-line-of-sight path (path band 2) keep the same
// colour ramp but are hatched: every `hatch`-th diagonal line of image
// pixels is darkened, so the hatching is visible at any zoom while the
// colour still reads. hatch 0 disables it.
export function rasterToRGBA(decoded, { scale = 8, alpha = 170, weak = -100, hatch = 4 } = {}) {
  const { width, height, nodata, mask } = decoded;
  const values = decoded.merged || decoded.values;
  const paths = decoded.mergedPaths || decoded.paths;
  const W = width * scale;
  const H = height * scale;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const k = sy * width + Math.floor(x / scale);
      const v = values[k];
      if (v === nodata || (mask && !mask[k])) continue; // stays transparent
      let [r, g, b] = signalColor(-v, { weak });
      if (hatch && paths && paths[k] === PATH_NLOS && (x + y) % hatch === 0) {
        r = (r * 0.45) | 0;
        g = (g * 0.45) | 0;
        b = (b * 0.45) | 0;
      }
      const o = (y * W + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = alpha;
    }
  }
  return { width: W, height: H, data: out };
}

// rasterToDataURL renders the raster into an offscreen canvas (browser
// only). paint is the painter, rasterToRGBA by default (building.js has
// one for the cell rasters of buildings).
export function rasterToDataURL(decoded, opts, paint = rasterToRGBA) {
  const { width, height, data } = paint(decoded, opts);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}
