// The path profile (docs/profile-api.md): a Profile link on a row of the
// point card or panel asks the service to explain the path from that
// radio to the point, and a drawer along the bottom of the map draws it:
// the terrain in the curved-Earth frame, the straight radio line, the
// first Fresnel zone, the tightest sample and, on an NLOS path, the
// Bullington construction. Everything here is pure (the request, the
// scales, the SVG as a string, the captions, the zoom arithmetic) apart
// from fetchProfile, so it is testable in Node (test/profile.test.js);
// app.js owns the drawer and the events.

import { fetchJSON } from "./patch.js";

// buildProfileRequest assembles a POST /api/v1/profile body from the point
// request a card came from: the same location, threshold, options and
// path flags, the one tower and radio of the row, and one receiver
// height: the candidate named by rxHeight ("above_ground" or
// "above_surface") when the point request has it, else whichever it has.
// samples and range are passed through when given.
export function buildProfileRequest({ request, towerId, radioId, rxHeight, samples, range }) {
  const tower = request.towers.find((t) => t.id === towerId);
  if (!tower) throw new Error(`no tower ${towerId} in the point request`);
  const radio = tower.radios.find((r) => r.id === radioId);
  if (!radio) throw new Error(`no radio ${radioId} on tower ${towerId}`);
  const heights = request.rx_height || {};
  const name = heights[rxHeight] > 0 ? rxHeight : Object.keys(heights).find((k) => heights[k] > 0);
  if (!name) throw new Error("the point request has no receiver height");
  const body = {
    units: request.units,
    location: request.location,
    min_signal_dbm: request.min_signal_dbm,
    rx_height: { [name]: heights[name] },
    tower: { id: tower.id, name: tower.name, lat: tower.lat, lon: tower.lon, radio },
    enable_los: request.enable_los,
    enable_nlos: request.enable_nlos,
  };
  if (request.options) body.options = request.options;
  if (request.rxclearance != null) body.rxclearance = request.rxclearance;
  if (samples) body.samples = samples;
  if (range) body.range = [Math.max(0, Math.floor(range[0])), Math.ceil(range[1])];
  return body;
}

// fetchProfile posts the request and returns the decoded reply.
export function fetchProfile(base, request, opts) {
  return fetchJSON(base, "/api/v1/profile", request, opts);
}

// unitLabel is the reply's length unit.
export function unitLabel(reply) {
  return reply.units === "imperial" ? "ft" : "m";
}

// --- the chart ---

// chartLayout computes the scales of a chart `width` by `height` pixels
// for a reply with bins: the x domain is the bins' range (extended to the
// receiver when the range reaches the end of the path), the y domain
// takes in the terrain in the curved frame, the antennas and the Fresnel
// zone, with a margin. Returns null for a reply without bins.
export function chartLayout(reply, { width, height, pad = { left: 46, right: 14, top: 10, bottom: 22 } } = {}) {
  const b = reply.bins;
  if (!b || !b.count) return null;
  const d = reply.distance;
  const x0 = b.range[0];
  const x1 = b.range[1] >= d - 1 ? d : b.range[1];
  const ys = [];
  for (let i = 0; i < b.count; i++) {
    if (b.ground[i] != null) ys.push(b.ground[i] + b.bulge[i]);
    if (b.surface[i] != null) ys.push(b.surface[i] + b.bulge[i]);
  }
  const line = lineAt(reply);
  if (line) {
    for (let i = 0; i < b.count; i++) {
      const l = line(b.distance[i]);
      ys.push(l + b.fresnel[i], l - b.fresnel[i]);
    }
    ys.push(reply.ap.antenna, reply.rx.antenna);
  } else if (reply.ap) {
    ys.push(reply.ap.antenna);
  }
  if (reply.ap && reply.ap.ground != null) ys.push(reply.ap.ground);
  if (reply.rx && reply.rx.ground != null) ys.push(reply.rx.ground);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) {
    ymin = 0;
    ymax = 1;
  }
  const span = Math.max(ymax - ymin, 1);
  ymin -= span * 0.08;
  ymax += span * 0.08;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xspan = Math.max(x1 - x0, 1e-9);
  return {
    width, height, pad, x0, x1, ymin, ymax, plotW, plotH,
    x: (v) => pad.left + ((v - x0) / xspan) * plotW,
    y: (v) => pad.top + ((ymax - v) / (ymax - ymin)) * plotH,
    invX: (px) => x0 + ((px - pad.left) / plotW) * xspan,
  };
}

// lineAt returns the direct line's height at a distance from the AP, or
// null when the receiver antenna is not placed.
export function lineAt(reply) {
  if (!reply.ap || !reply.rx || reply.rx.antenna == null || !(reply.distance > 0)) return null;
  const a = reply.ap.antenna;
  const slope = (reply.rx.antenna - a) / reply.distance;
  return (x) => a + slope * x;
}

// niceTicks returns round tick values covering [lo, hi] with about n
// steps: a step of 1, 2 or 5 times a power of ten.
export function niceTicks(lo, hi, n = 5) {
  const raw = (hi - lo) / Math.max(1, n);
  if (!(raw > 0)) return [lo];
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
const pt = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`;

// runs splits the bin indices into runs of consecutive bins for which
// keep(i) holds.
function runs(count, keep) {
  const out = [];
  let run = null;
  for (let i = 0; i < count; i++) {
    if (keep(i)) {
      if (!run) run = [];
      run.push(i);
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out;
}

// chartSVG draws the reply into an SVG string for the given layout. It
// draws, back to front: the clearance zones, the ground (brown) and the
// clutter above it (grey, green where the bin is mostly vegetation), the
// first Fresnel zone as a translucent band with the 0.6 F1 boundary
// dashed, the direct line, the antennas, the tightest sample and the
// Bullington construction. Values are the reply's own (the request's
// units); the terrain is lifted by the Earth bulge, the line is straight.
export function chartSVG(reply, L) {
  const b = reply.bins;
  const u = unitLabel(reply);
  const { x, y } = L;
  const bottom = L.pad.top + L.plotH;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" class="profile-svg">`);
  parts.push(`<defs><clipPath id="plot"><rect x="${L.pad.left}" y="${L.pad.top}" width="${L.plotW}" height="${L.plotH}"/></clipPath></defs>`);
  parts.push(`<rect x="${L.pad.left}" y="${L.pad.top}" width="${L.plotW}" height="${L.plotH}" class="plot-bg"/>`);
  parts.push(`<g clip-path="url(#plot)">`);
  // Clearance zones: the AP's circle and the receiver clearance.
  if (reply.ap && reply.ap.apclearance > 0) {
    parts.push(`<rect x="${x(0).toFixed(1)}" y="${L.pad.top}" width="${Math.max(0, x(reply.ap.apclearance) - x(0)).toFixed(1)}" height="${L.plotH}" class="zone"/>`);
  }
  if (reply.rx && reply.rx.rxclearance > 0) {
    const from = x(reply.distance - reply.rx.rxclearance);
    parts.push(`<rect x="${from.toFixed(1)}" y="${L.pad.top}" width="${Math.max(0, x(reply.distance) - from).toFixed(1)}" height="${L.plotH}" class="zone"/>`);
  }
  // Ground: polygons down to the bottom of the plot, one per run of data.
  const gy = (i) => y(b.ground[i] + b.bulge[i]);
  const sy = (i) => y(b.surface[i] + b.bulge[i]);
  for (const run of runs(b.count, (i) => b.ground[i] != null)) {
    const pts = run.map((i) => pt(x(b.distance[i]), gy(i)));
    const first = run[0], last = run[run.length - 1];
    parts.push(`<polygon class="ground" points="${pt(x(b.distance[first]), bottom)} ${pts.join(" ")} ${pt(x(b.distance[last]), bottom)}"/>`);
  }
  // Clutter: surface down to the ground (or the bottom where the ground
  // has no data), grey, then the vegetation runs in green.
  const base = (i) => (b.ground[i] != null ? gy(i) : bottom);
  const clutter = (keep, cls) => {
    for (const run of runs(b.count, (i) => b.surface[i] != null && keep(i))) {
      const top = run.map((i) => pt(x(b.distance[i]), sy(i)));
      const under = run.slice().reverse().map((i) => pt(x(b.distance[i]), base(i)));
      parts.push(`<polygon class="${cls}" points="${top.join(" ")} ${under.join(" ")}"/>`);
    }
  };
  clutter(() => true, "surface");
  clutter((i) => b.veg[i] >= 0.5, "veg");
  const line = lineAt(reply);
  if (line) {
    // The first Fresnel zone and the 0.6 F1 boundary.
    const f = reply.fresnel_clearance || 0.6;
    const upper = [], lower = [], up6 = [], lo6 = [];
    for (let i = 0; i < b.count; i++) {
      const dx = b.distance[i], l = line(dx), r1 = b.fresnel[i];
      upper.push(pt(x(dx), y(l + r1)));
      lower.push(pt(x(dx), y(l - r1)));
      up6.push(pt(x(dx), y(l + f * r1)));
      lo6.push(pt(x(dx), y(l - f * r1)));
    }
    parts.push(`<polygon class="fresnel" points="${pt(x(0), y(line(0)))} ${upper.join(" ")} ${pt(x(reply.distance), y(line(reply.distance)))} ${lower.reverse().join(" ")}"/>`);
    parts.push(`<polyline class="fresnel-clear" points="${up6.join(" ")}"/>`);
    parts.push(`<polyline class="fresnel-clear" points="${lo6.join(" ")}"/>`);
    // The direct line.
    parts.push(`<line class="ray" x1="${x(0).toFixed(1)}" y1="${y(line(0)).toFixed(1)}" x2="${x(reply.distance).toFixed(1)}" y2="${y(line(reply.distance)).toFixed(1)}"/>`);
  }
  // Bullington: the tangents from each antenna over its obstacle to the
  // edge, the obstacles and the edge.
  const bl = reply.bullington;
  if (bl && line && bl.edge && bl.edge.distance != null) {
    const ex = bl.edge.distance, ey = bl.edge.height;
    if (bl.from_ap) parts.push(`<line class="tangent" x1="${x(0).toFixed(1)}" y1="${y(reply.ap.antenna).toFixed(1)}" x2="${x(ex).toFixed(1)}" y2="${y(ey).toFixed(1)}"/>`);
    if (bl.from_rx) parts.push(`<line class="tangent" x1="${x(reply.distance).toFixed(1)}" y1="${y(reply.rx.antenna).toFixed(1)}" x2="${x(ex).toFixed(1)}" y2="${y(ey).toFixed(1)}"/>`);
    for (const o of [bl.from_ap, bl.from_rx]) {
      if (o) parts.push(`<circle class="obstacle" cx="${x(o.distance).toFixed(1)}" cy="${y(o.height).toFixed(1)}" r="3"/>`);
    }
    parts.push(`<path class="edge" d="M ${pt(x(ex), y(ey) - 7)} l -5 10 h 10 z"/>`);
    parts.push(`<text class="label" x="${(x(ex) + 8).toFixed(1)}" y="${(y(ey) - 6).toFixed(1)}">v = ${bl.edge.v}</text>`);
  }
  // The tightest sample.
  const t = reply.tightest;
  if (t) {
    const tx = x(t.distance), ty = y(t.surface + t.bulge);
    parts.push(`<circle class="tight" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4"/>`);
    const label = `${t.fresnel} F1 at ${fmt(t.distance)} ${u}`;
    const anchor = tx > L.pad.left + L.plotW * 0.75 ? "end" : "start";
    parts.push(`<text class="label" x="${(tx + (anchor === "end" ? -8 : 8)).toFixed(1)}" y="${(ty + 14).toFixed(1)}" text-anchor="${anchor}">${label}</text>`);
  }
  // Antennas: a stem from the cell to the antenna centre, and a dot.
  if (reply.ap) {
    const foot = reply.ap.ground != null ? reply.ap.ground : reply.ap.antenna - reply.ap.height;
    parts.push(`<line class="mast" x1="${x(0).toFixed(1)}" y1="${y(foot).toFixed(1)}" x2="${x(0).toFixed(1)}" y2="${y(reply.ap.antenna).toFixed(1)}"/>`);
    parts.push(`<circle class="antenna" cx="${x(0).toFixed(1)}" cy="${y(reply.ap.antenna).toFixed(1)}" r="3.5"/>`);
  }
  if (reply.rx && reply.rx.antenna != null) {
    const foot = reply.rx.rx_height === "above_surface" && reply.rx.surface != null ? reply.rx.surface : reply.rx.ground != null ? reply.rx.ground : reply.rx.antenna - reply.rx.height;
    parts.push(`<line class="mast" x1="${x(reply.distance).toFixed(1)}" y1="${y(foot).toFixed(1)}" x2="${x(reply.distance).toFixed(1)}" y2="${y(reply.rx.antenna).toFixed(1)}"/>`);
    parts.push(`<circle class="antenna" cx="${x(reply.distance).toFixed(1)}" cy="${y(reply.rx.antenna).toFixed(1)}" r="3.5"/>`);
  }
  parts.push(`</g>`);
  // Axes.
  for (const v of niceTicks(L.x0, L.x1, Math.max(3, Math.floor(L.plotW / 90)))) {
    parts.push(`<line class="tick" x1="${x(v).toFixed(1)}" y1="${bottom}" x2="${x(v).toFixed(1)}" y2="${bottom + 4}"/>`);
    parts.push(`<text class="axis" x="${x(v).toFixed(1)}" y="${bottom + 15}" text-anchor="middle">${fmt(v)}</text>`);
  }
  for (const v of niceTicks(L.ymin, L.ymax, Math.max(2, Math.floor(L.plotH / 40)))) {
    parts.push(`<line class="grid" x1="${L.pad.left}" y1="${y(v).toFixed(1)}" x2="${L.pad.left + L.plotW}" y2="${y(v).toFixed(1)}"/>`);
    parts.push(`<text class="axis" x="${L.pad.left - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`);
  }
  // The unit, inside the plot's top right corner, clear of the ticks.
  parts.push(`<text class="axis unit" x="${L.pad.left + L.plotW - 4}" y="${L.pad.top + 11}" text-anchor="end">${u} from the AP, heights in ${u}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

// --- text ---

// profileTitle names the pair and the receiver.
export function profileTitle(reply) {
  const t = reply.tower || {};
  const rx = reply.rx;
  const u = unitLabel(reply);
  let s = `${t.name || t.id} / ${t.radio_name || t.radio} → point`;
  if (rx) s += `, receiver ${rx.height} ${u} ${rx.rx_height === "above_surface" ? "above the surface" : "above ground"}`;
  return s;
}

// profileCaption summarises the figures under the chart.
export function profileCaption(reply) {
  const u = unitLabel(reply);
  if (reply.skipped) return `Skipped (${reply.skipped.replace(/_/g, " ")}).`;
  const l = reply.link || {};
  const parts = [];
  if (l.path) {
    let s = `${l.path.toUpperCase()}`;
    if (l.signal_dbm != null) s += ` ${l.signal_dbm} dBm${l.covered ? "" : " (below the minimum)"}`;
    parts.push(s);
  } else {
    parts.push("no path");
  }
  if (l.reason) parts.push(l.reason.replace(/_/g, " "));
  if (l.free_space_dbm != null) parts.push(`free space ${l.free_space_dbm} dBm`);
  if (l.excess_loss_db != null) {
    let s = `excess loss ${l.excess_loss_db} dB`;
    if (l.diffraction_db != null) {
      s += ` (diffraction ${l.diffraction_db}`;
      if (l.vegetation_db) s += `, vegetation ${l.vegetation_db} over ${fmt(l.vegetation_m)} ${u} of canopy`;
      s += ")";
    }
    parts.push(s);
  }
  if (reply.tightest) parts.push(`tightest ${reply.tightest.fresnel} F1 at ${fmt(reply.tightest.distance)} ${u} (${reply.tightest.clearance} ${u} clear)`);
  parts.push(`${fmt(reply.distance)} ${u}, ${reply.frequency_mhz / 1000} GHz, k = ${reply.k_factor === 1.3333 ? "4/3" : reply.k_factor}`);
  if (reply.nlos_skipped) parts.push("line of sight only (above the NLOS frequency ceiling)");
  return parts.join(" · ");
}

// binAt is the index of the bin whose centre is nearest the chart pixel
// px, or -1 outside the plot.
export function binAt(reply, L, px) {
  const b = reply.bins;
  if (!b || px < L.pad.left || px > L.pad.left + L.plotW) return -1;
  const d = L.invX(px);
  let best = -1, dist = Infinity;
  for (let i = 0; i < b.count; i++) {
    const dd = Math.abs(b.distance[i] - d);
    if (dd < dist) {
      best = i;
      dist = dd;
    }
  }
  return best;
}

// readout describes bin i for the hover label.
export function readout(reply, i) {
  const b = reply.bins;
  const u = unitLabel(reply);
  const parts = [`${fmt(b.distance[i])} ${u}`];
  if (b.ground[i] != null) parts.push(`ground ${fmt(b.ground[i])}`);
  if (b.surface[i] != null) parts.push(`surface ${fmt(b.surface[i])}${b.veg[i] >= 0.5 ? " (trees)" : ""}`);
  const line = lineAt(reply);
  if (line && b.surface[i] != null) {
    const c = line(b.distance[i]) - b.surface[i] - b.bulge[i];
    const f = b.fresnel[i] > 0 ? ` (${(c / b.fresnel[i]).toFixed(2)} F1)` : "";
    parts.push(`clearance ${fmt(c)} ${u}${f}`);
  }
  parts.push(`r1 ${fmt(b.fresnel[i])}, bulge ${fmt(b.bulge[i])}`);
  return parts.join(" · ");
}

// zoomRange is the range after a wheel step: the current span divided by
// factor (more than 1 zooms in) about the fraction f of the span under
// the pointer, kept inside the path and no shorter than minSpan. Returns
// null when nothing changes (already the whole path and zooming out).
export function zoomRange(current, distance, f, factor, minSpan = 20) {
  const [r0, r1] = current;
  const span = r1 - r0;
  let next = Math.min(distance, Math.max(minSpan, span / factor));
  if (next >= distance && span >= distance) return null;
  const c = r0 + f * span;
  let n0 = c - f * next;
  let n1 = n0 + next;
  if (n0 < 0) {
    n1 -= n0;
    n0 = 0;
  }
  if (n1 > distance) {
    n0 -= n1 - distance;
    n1 = distance;
    if (n0 < 0) n0 = 0;
  }
  return [n0, n1];
}

// --- the window held by the page ---
//
// The page keeps one reply (a window of the path at some bin step) and
// draws the view it wants from it, asking the service again only when the
// view needs finer bins than the window has or runs past its ends.

export const MaxSamples = 2000; // the service's ceiling on samples

// viewStep is the bin step a view of `span` needs on a plot `plotW`
// pixels wide: one bin per pixel, never finer than 1.
export function viewStep(span, plotW) {
  return Math.max(1, Math.ceil(span / Math.max(1, plotW)));
}

// covers says whether the held reply can draw the view (null for the
// whole path) on a plot `plotW` wide: its bins span the view at a step
// no coarser than the view needs.
export function covers(reply, view, plotW) {
  const b = reply && reply.bins;
  if (!b || !b.count) return false;
  const d = reply.distance;
  const [v0, v1] = view || [0, d];
  const r1 = b.range[1] >= d - 1 ? d : b.range[1];
  return b.range[0] <= v0 + 1e-9 && r1 >= v1 - 1e-9 && b.step <= viewStep(v1 - v0, plotW);
}

// fetchWindow is the request ({ range, samples }) for a view: the longest
// stretch the service can return at the step the view needs, centred on
// the view and kept inside the path, so that panning and zooming nearby
// are drawn from the one reply. The whole path (view null, or a window
// that would reach both ends) is asked for without a range.
export function fetchWindow(view, distance, plotW, maxSamples = MaxSamples) {
  const whole = { samples: maxSamples };
  if (!view || !(distance > 0)) return whole;
  const [v0, v1] = view;
  const span = v1 - v0;
  // Two less than the ceiling so the rounding of the ends cannot push the
  // service's step above the view's.
  const w = maxSamples * viewStep(span, plotW) - 2;
  if (w >= distance) return whole;
  let a = v0 - (w - span) / 2;
  if (a < 0) a = 0;
  let z = a + w;
  if (z > distance) {
    z = distance;
    a = Math.max(0, z - w);
  }
  const range = [Math.floor(a), Math.ceil(z)];
  return { range, samples: Math.min(maxSamples, range[1] - range[0]) };
}

// viewOf is the reply cut down to a view: the bins overlapping it with
// one more on each side (so the terrain runs off the plot's edges), the
// bins' range set to the view. The reply itself for the whole path.
export function viewOf(reply, view) {
  const b = reply.bins;
  if (!view || !b || !b.count) return reply;
  const [v0, v1] = view;
  const i0 = Math.max(0, Math.floor((v0 - b.range[0]) / b.step) - 1);
  const i1 = Math.min(b.count - 1, Math.ceil((v1 - b.range[0]) / b.step));
  const bins = { ...b, range: [v0, v1], count: i1 - i0 + 1 };
  for (const k of Object.keys(b)) {
    if (k !== "range" && Array.isArray(b[k])) bins[k] = b[k].slice(i0, i1 + 1);
  }
  return { ...reply, bins };
}

// panRange is the range shifted along the path by delta (positive towards
// the receiver), kept inside the path. Returns null when nothing changes:
// the whole path is shown, or the range is already at that end.
export function panRange(current, distance, delta) {
  const [r0, r1] = current;
  const span = r1 - r0;
  if (span >= distance || delta === 0) return null;
  let n0 = Math.min(distance - span, Math.max(0, r0 + delta));
  if (n0 === r0) return null;
  return [n0, n0 + span];
}
