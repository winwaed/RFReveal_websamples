// The point query (docs/point-api.md): a right click on the map asks the
// service for the link budget from every radio of the ticked towers to a
// receiver at that point, with the bearings each way. The page draws a
// line from the point to each tower and a popup with the figures. Pure
// functions apart from fetchPoint, so they are testable in Node (see
// test/point.test.js).

import { fetchJSON, pathFlags, signalColor } from "./patch.js";

// buildPointRequest assembles a POST /api/v1/point body for the point at
// (lat, lon) using the enabled towers: the patch request without the
// patch (no radius). Heights are metres; a height that is not positive is
// left out (the service needs at least one).
export function buildPointRequest({ lat, lon, towers, aboveGround = 0, aboveSurface = 0, minSignalDbm, atmosphere = "none", enableLOS = true, enableNLOS = true, rxClearance = 0 }) {
  const rx = {};
  if (aboveGround > 0) rx.above_ground = aboveGround;
  if (aboveSurface > 0) rx.above_surface = aboveSurface;
  const req = {
    units: "metric",
    location: { lat, lon },
    min_signal_dbm: minSignalDbm,
    rx_height: rx,
    towers: towers.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lon: t.lon, radios: t.radios })),
  };
  if (atmosphere && atmosphere !== "none") req.options = { atmosphere };
  Object.assign(req, pathFlags({ enableLOS, enableNLOS, rxClearance }));
  return req;
}

// fetchPoint posts the request and returns the decoded reply.
export function fetchPoint(base, request, opts) {
  return fetchJSON(base, "/api/v1/point", request, opts);
}

// bestRadio picks a tower's radio to show: the strongest covered one,
// else the strongest with a signal below the threshold, else null (every
// radio skipped or without a path).
export function bestRadio(tower) {
  let best = null;
  for (const r of tower.radios) {
    if (r.skipped || r.signal_dbm == null) continue;
    if (!best || (r.covered && !best.covered) || (r.covered === best.covered && r.signal_dbm > best.signal_dbm)) best = r;
  }
  return best;
}

// towerRows reduces a reply to one row per tower: the tower, its best
// radio (or null) and the bearings and distance from the tower entry.
export function towerRows(reply) {
  return reply.towers.map((t) => {
    const radio = bestRadio(t);
    const skipped = t.radios.every((r) => r.skipped);
    return {
      tower: t,
      radio,
      skipped: skipped ? [...new Set(t.radios.map((r) => r.skipped))].join(", ") : "",
      signal: radio ? radio.signal_dbm : null,
      path: radio ? radio.path : null,
      covered: Boolean(radio && radio.covered),
      distance: t.distance,
      azimuthToTower: t.azimuth_to_tower_deg,
      azimuthFromTower: t.azimuth_deg,
    };
  });
}

// NO_PATH is the colour of a line to a tower nothing reaches the point from.
export const NO_PATH = [158, 158, 158];

// lineStyle is the colour and dash of the line to a tower: the signal
// palette for a radio with a signal (the weak end at the minimum signal,
// so a level below it is the weakest colour), grey when nothing reaches
// the point; solid for line of sight, dashed for a non-line-of-sight
// path, and dotted when there is no path at all.
export function lineStyle(row, { weak = -100 } = {}) {
  if (row.signal == null) return { color: NO_PATH, dash: "dotted" };
  return { color: signalColor(row.signal, { weak }), dash: row.path === "nlos" ? "dashed" : "solid" };
}

// rgb formats a colour triple for CSS and the Maps API.
export function rgb(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// degrees formats a bearing with the degree sign, whole degrees.
export function degrees(v) {
  return v == null ? "–" : `${Math.round(v)}°`;
}

// heightText describes the receiver heights a reply was computed for,
// from the request (the reply echoes the cell's elevations, not the
// heights).
export function heightText(request) {
  const rx = request.rx_height || {};
  const parts = [];
  if (rx.above_ground) parts.push(`${rx.above_ground} m above ground`);
  if (rx.above_surface) parts.push(`${rx.above_surface} m above the surface`);
  return parts.join(" or ");
}
