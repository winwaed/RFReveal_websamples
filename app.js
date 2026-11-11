// The page: a Google map with the towers, checkboxes, options, and a
// click handler that fetches a patch, draws its raster with a circle at
// the patch radius and opens a popup with the reply (one popup at a
// time). Rasters and circles stay on the map until the Clear button
// removes them; where rasters overlap, each pixel shows the strongest
// signal of the patches covering it (see patch.js, "combining several
// patches"), and the circles draw above every raster. A Debug button at
// the top right opens a pane showing the last request sent to the
// service and its reply (debug.js). The buildings mode (building.js)
// sends the OpenStreetMap footprints within a radius of the ticked towers
// to the building endpoint in batches and colours them on the map's Data
// layer as the replies arrive; a click on a building opens its figures.
// The two modes are
// exclusive: the mode switch shows one mode's controls, overlays and key
// at a time, so the key never mixes the two palettes. In either mode a
// right click asks the point endpoint (point.js) for the link budget from
// every radio of the ticked towers to that point: a line is drawn from the
// point to each tower, coloured by the best signal, and a card beside the
// point lists the figures and bearings; the card can be dragged out of the
// way, and its Hide button removes it with the lines; the next right
// click replaces them.

import { buildRequest, decodeRaster, fetchPatch, flagsValid, maskUnder, mergeStrongest, rasterToDataURL, signalColor } from "./patch.js";
import { batches, bestRadiosPerTower, buildBuildingRequest, buildingColor, coverageColor, fetchBuildings, loadBuildings, selectWithin, toFeature } from "./building.js";
import { loadTowers } from "./towers.js";
import { buildPointRequest, degrees, fetchPoint, heightText, lineStyle, rgb, towerRows } from "./point.js";
import { exchangeSummary, prettyJSON } from "./debug.js";
import { binAt, buildProfileRequest, chartLayout, chartSVG, covers as viewCovered, fetchProfile, fetchWindow, panRange, profileCaption, profileTitle, readout, unitLabel, viewOf, zoomRange } from "./profile.js";
import { extentSummary, fetchExtent, maskPaths } from "./extent.js";

const config = window.RFREVEAL_CONFIG || {};
const API_BASE = (config.apiBase || "http://localhost:8080").replace(/\/+$/, "");
const MAP_ID = config.mapId || "DEMO_MAP_ID";
const ON = { background: "#1565c0", border: "#0d47a1" };
const OFF = { background: "#9e9e9e", border: "#616161" };

const $ = (id) => document.getElementById(id);
let TOWERS = []; // from towers.json, see towers.js
let MAP_CENTER = null;
const enabled = new Set();
const markers = {}; // tower id -> { marker, pin }
let map = null;
const patches = []; // every patch drawn so far: { decoded, overlay, weak, circle }
let clickMarker = null;
let lastExchange = null; // the latest request/reply record from fetchJSON, for the debug pane
let debugOpen = false;
let popup = null; // the one InfoWindow, moved to each new result
let inFlight = null; // AbortController of the running request
let BUILDINGS = []; // from buildings.json, see building.js
const buildingResults = new Map(); // building id -> { result, reply } once evaluated
let buildingRun = null; // AbortController of the running batch sequence
const BATCH = 300; // buildings per request (nlos-plan.md 7.4: a batch of 400 with NLOS ran close to the 120 s deadline)
let mode = "patch"; // "patch" or "buildings": which controls, overlays and key show
let point = null; // the right-click query on the map: { card, dot, lines, request, reply } until hidden or replaced
let pointInFlight = null; // AbortController of the running point request
let extentMask = null; // the Polygon greying out everything outside the elevation dataset
let profile = null; // the open path profile (profile.js): { towerId, radioId, rxHeight, request, reply, view, shown, layout, halo } until closed
let profileInFlight = null; // AbortController of the running profile request
let profileWanted = false; // the view moved while a request was in flight: show it again when the reply is in

// dbm formats a signal level; null (fewer covered cells than the rank) shows as "–".
function dbm(v) {
  return v == null ? "–" : `${v} dBm`;
}

function options() {
  return {
    radius: Number($("radius").value),
    aboveGround: Number($("aboveGround").value),
    aboveSurface: Number($("aboveSurface").value),
    minSignalDbm: Number($("minSignalDbm").value),
    atmosphere: $("atmosphere").value,
    enableLOS: $("enableLOS").checked,
    enableNLOS: $("enableNLOS").checked,
    rxClearance: Number($("rxClearance").value),
    buildingRadius: Number($("buildingRadius").value),
    colourBy: $("colourBy").value,
  };
}

function show(id, text) {
  const el = $(id);
  el.textContent = text || "";
  el.hidden = !text;
}

// checkFlags refuses a request with neither path type selected (the
// service answers 400) by writing the reason to the given error line.
function checkFlags(opts, errorId) {
  if (flagsValid(opts)) return true;
  show(errorId, "tick at least one of Line of sight and Non-line-of-sight");
  return false;
}

// --- towers ---

function renderTowerList() {
  const box = $("towers");
  box.replaceChildren();
  const radios = TOWERS.reduce((n, t) => n + t.radios.length, 0);
  $("towerCount").textContent = `(${TOWERS.length} towers, ${radios} radios from towers.json)`;
  for (const t of TOWERS) {
    const label = document.createElement("label");
    label.className = "row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = enabled.has(t.id);
    cb.addEventListener("change", () => {
      if (cb.checked) enabled.add(t.id);
      else enabled.delete(t.id);
      styleMarker(t.id);
    });
    const span = document.createElement("span");
    span.append(`${t.name} `);
    const small = document.createElement("small");
    small.textContent = `(${t.radios.length} radios)`;
    span.append(small);
    label.append(cb, span);
    box.append(label);
  }
}

function styleMarker(id) {
  const m = markers[id];
  if (!m) return;
  const c = enabled.has(id) ? ON : OFF;
  m.pin.background = c.background;
  m.pin.borderColor = c.border;
  m.marker.content.style.opacity = enabled.has(id) ? "1" : "0.6";
}

// --- map ---

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  return new Promise((resolve, reject) => {
    const cb = "__patchMapReady";
    window[cb] = () => {
      delete window[cb];
      resolve(window.google.maps);
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", callback: cb });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => reject(new Error("the Google Maps script failed to load"));
    document.head.appendChild(s);
  });
}

async function initMap() {
  if (!config.googleMapsApiKey) {
    show("error", "no Google Maps API key: put yours in config.local.js (or config.js); see config.js");
    return;
  }
  const gm = await loadGoogleMaps(config.googleMapsApiKey);
  await Promise.all([gm.importLibrary("maps"), gm.importLibrary("marker")]);
  map = new gm.Map($("map"), {
    center: MAP_CENTER,
    zoom: 14,
    mapId: MAP_ID,
    mapTypeId: "hybrid",
    clickableIcons: false,
    streetViewControl: false,
    fullscreenControl: false, // the Debug button takes that corner; full screen would hide the panels anyway
    tilt: 0,
  });
  for (const t of TOWERS) {
    const pin = new gm.marker.PinElement({ glyph: "T", background: ON.background, borderColor: ON.border });
    const marker = new gm.marker.AdvancedMarkerElement({
      map,
      position: { lat: t.lat, lng: t.lon },
      title: `${t.name} (${t.radios.length} radios)`,
      content: pin.element,
    });
    markers[t.id] = { marker, pin };
    styleMarker(t.id);
  }
  // A click on the point card (its Hide button, say) also reaches the
  // map as a click at that spot, since the card's marker is not a
  // clickable marker; it is not a request for a patch.
  const onCard = (ev) => Boolean(ev.domEvent && ev.domEvent.target && ev.domEvent.target.closest && ev.domEvent.target.closest(".point-card"));
  map.addListener("click", (ev) => {
    if (onCard(ev)) return;
    if (mode === "patch") evaluate(ev.latLng.lat(), ev.latLng.lng());
  });
  drawExtent();
  // A right click anywhere, in either mode, is a point query. The
  // footprints and the Data layer take the event themselves, so it is
  // listened for there too.
  map.addListener("contextmenu", (ev) => {
    if (!onCard(ev)) evaluatePoint(ev.latLng.lat(), ev.latLng.lng());
  });
  map.data.addListener("contextmenu", (ev) => evaluatePoint(ev.latLng.lat(), ev.latLng.lng()));
  // Building footprints live on the Data layer; a click on one is a
  // building popup, not a patch.
  map.data.setStyle(styleBuilding);
  map.data.addListener("click", (ev) => openBuildingPopup(ev.feature));
  applyMode();
}

// --- modes ---

// setMode switches the page between patches and buildings: the other
// mode's controls are hidden, its overlays taken off the map (they come
// back on switching back), the popup closed and the key redrawn.
function setMode(m) {
  if (m === mode) return;
  mode = m;
  if (popup) popup.close();
  applyMode();
}

function applyMode() {
  for (const node of document.querySelectorAll("[data-mode]")) node.hidden = node.dataset.mode !== mode;
  if (map) {
    for (const p of patches) {
      p.overlay.setMap(mode === "patch" ? map : null);
      p.circle.setMap(mode === "patch" ? map : null);
    }
    if (clickMarker) clickMarker.map = mode === "patch" ? map : null;
    map.data.setMap(mode === "buildings" ? map : null);
  }
  renderLegend();
}

// --- evaluation ---

async function evaluate(lat, lon) {
  const gm = window.google.maps;
  const towers = TOWERS.filter((t) => enabled.has(t.id));
  show("error", "");
  if (towers.length === 0) {
    show("error", "enable at least one tower");
    return;
  }
  const opts = options();
  if (!checkFlags(opts, "error")) return;
  if (inFlight) inFlight.abort();
  const ctl = new AbortController();
  inFlight = ctl;

  if (!clickMarker) clickMarker = new gm.marker.AdvancedMarkerElement({ map });
  clickMarker.position = { lat, lng: lon };
  if (popup) popup.close();

  show("status", "Evaluating…");
  try {
    const reply = await fetchPatch(API_BASE, buildRequest({ lat, lon, towers, ...opts }), { signal: ctl.signal, trace });
    if (ctl.signal.aborted) return;
    renderResult(reply, { lat, lon });
    openPopup(reply, { lat, lon }, opts.radius);
    if (reply.raster) {
      const decoded = await decodeRaster(reply.raster);
      // The circle marks the patch the service evaluated: its echoed
      // centre and radius (metres; the request is metric).
      const centre = reply.location || { lat, lon };
      addPatch(decoded, opts.minSignalDbm, { lat: centre.lat, lon: centre.lon, radiusM: reply.radius ?? opts.radius });
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    show("error", e.message);
  } finally {
    if (inFlight === ctl) {
      inFlight = null;
      show("status", "");
    }
  }
}

// drawPatch (re)creates the GroundOverlay of a patch from its current
// merged values and mask.
function drawPatch(p, weak) {
  const gm = window.google.maps;
  const url = rasterToDataURL(p.decoded, { weak });
  const b = p.decoded.bounds;
  const bounds = new gm.LatLngBounds({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east });
  if (p.overlay) p.overlay.setMap(null);
  p.overlay = new gm.GroundOverlay(url, bounds, { map, clickable: false, opacity: 1 });
}

// addPatch draws a new patch so that every pixel on the map shows the
// strongest signal of the patches covering it: the new patch takes the
// strongest value of itself and the earlier ones, and the earlier ones
// stop drawing the pixels under it. A circle at the patch radius outlines
// it; Google Maps draws vector shapes above every GroundOverlay, so the
// circles of earlier patches stay visible under later rasters.
function addPatch(decoded, weak, { lat, lon, radiusM }) {
  const gm = window.google.maps;
  const earlier = patches.map((p) => p.decoded);
  const merged = mergeStrongest(decoded, earlier);
  decoded.merged = merged.values;
  decoded.mergedPaths = merged.paths;
  for (const p of patches) {
    const mask = maskUnder(p.decoded, decoded);
    if (!mask) continue;
    p.decoded.mask = mask;
    drawPatch(p, p.weak);
  }
  const circle = new gm.Circle({
    map,
    center: { lat, lng: lon },
    radius: radiusM,
    strokeColor: "#ffffff",
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillOpacity: 0,
    clickable: false, // a click inside the circle is a new patch, as anywhere else
    zIndex: patches.length + 1,
  });
  const p = { decoded, overlay: null, weak, circle };
  drawPatch(p, weak);
  patches.push(p);
  $("clear").disabled = false;
}

// clearRasters removes every drawn raster with its circle, and the click
// marker.
function clearRasters() {
  for (const p of patches.splice(0)) {
    p.overlay.setMap(null);
    p.circle.setMap(null);
  }
  if (clickMarker) clickMarker.position = null;
  if (popup) popup.close();
  $("clear").disabled = true;
}

// --- point query (right click) ---

// drawExtent asks the service for the area its elevation dataset covers
// (docs/extent-api.md) and greys out everything else: one Polygon whose
// first path is the whole map and whose other paths are the extent's
// rings, so the dataset's islands are cut out of the shading and any
// hole inside them shaded again. The mask takes no clicks, so a click or
// right click on it still reaches the map (and gets the service's
// outside-the-dataset answer). The panel names the dataset and its size.
async function drawExtent() {
  const gm = window.google.maps;
  try {
    const feature = await fetchExtent(API_BASE, { trace });
    extentMask = new gm.Polygon({
      map,
      paths: maskPaths(feature),
      strokeColor: "#444",
      strokeOpacity: 0.9,
      strokeWeight: 1.5,
      fillColor: "#000",
      fillOpacity: 0.35,
      clickable: false,
      zIndex: 0,
    });
    $("extent").textContent = `Elevation data: ${extentSummary(feature)}; the map is shaded outside it.`;
  } catch (e) {
    $("extent").textContent = `Elevation extent unknown: ${e.message}`;
  }
}

// evaluatePoint asks the service for the link budget to a receiver at
// the right-clicked point from the radios of the ticked towers, at the
// heights of the current mode (both heights in the patches mode, above
// the surface only in the buildings mode, as the mode's own requests),
// then draws the lines and the popup. An earlier point is removed first.
async function evaluatePoint(lat, lon) {
  const towers = TOWERS.filter((t) => enabled.has(t.id));
  const errorId = mode === "patch" ? "error" : "buildingError";
  show(errorId, "");
  if (towers.length === 0) return show(errorId, "enable at least one tower");
  const opts = options();
  if (!checkFlags(opts, errorId)) return;
  const heights = mode === "patch" ? { aboveGround: opts.aboveGround, aboveSurface: opts.aboveSurface } : { aboveSurface: opts.aboveSurface };
  if (!(heights.aboveGround > 0) && !(heights.aboveSurface > 0)) return show(errorId, "set a receiver height");
  hidePoint();
  const ctl = new AbortController();
  pointInFlight = ctl;
  const request = buildPointRequest({ lat, lon, towers, ...heights, minSignalDbm: opts.minSignalDbm, atmosphere: opts.atmosphere, enableLOS: opts.enableLOS, enableNLOS: opts.enableNLOS, rxClearance: opts.rxClearance });
  show("status", "Evaluating the point…");
  try {
    const reply = await fetchPoint(API_BASE, request, { signal: ctl.signal, trace });
    if (ctl.signal.aborted) return;
    drawPoint(reply, request, { lat, lon }, opts.minSignalDbm);
  } catch (e) {
    if (e.name === "AbortError") return;
    show(errorId, e.message);
  } finally {
    if (pointInFlight === ctl) {
      pointInFlight = null;
      show("status", "");
    }
  }
}

// drawPoint draws a line from the point to each tower of the reply,
// coloured by the tower's best signal (solid for line of sight, dashed
// for NLOS, grey dotted when nothing reaches the point), marks the point
// with a dot, opens a card beside it with one row per tower and puts the
// full radio table in the panel. The card is a draggable advanced marker
// (an InfoWindow cannot be moved), so it can be pulled off the lines.
function drawPoint(reply, request, at, weak) {
  const gm = window.google.maps;
  const rows = towerRows(reply);
  const lines = rows.map((row, i) => {
    const t = TOWERS.find((x) => x.id === row.tower.id);
    if (!t) return null;
    const st = lineStyle(row, { weak });
    const dashed = st.dash !== "solid";
    return new gm.Polyline({
      map,
      path: [{ lat: at.lat, lng: at.lon }, { lat: t.lat, lng: t.lon }],
      geodesic: true,
      strokeColor: rgb(st.color),
      strokeOpacity: dashed ? 0 : 0.95,
      strokeWeight: 3,
      // A dashed line is a repeated short stroke along an invisible one.
      icons: dashed ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.95, strokeColor: rgb(st.color), strokeWeight: 3, scale: st.dash === "dotted" ? 1.5 : 4 }, offset: "0", repeat: st.dash === "dotted" ? "8px" : "16px" }] : [],
      clickable: false,
      zIndex: 2000 + i,
    });
  }).filter(Boolean);
  const content = pointContent(reply, request, at, rows, { towersOnly: true });
  const hide = el("button", { type: "button", className: "hide", title: "Hide this point's card and lines" }, "Hide");
  hide.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hidePoint();
  });
  const card = el("div", { className: "popup point-card", title: "Drag to move" }, el("div", { className: "grip" }, el("span", {}, "Point"), hide), content);
  // The wheel scrolls the card, not the map under it.
  card.addEventListener("wheel", (ev) => ev.stopPropagation());
  // An advanced marker's own element is a box the size of its content
  // with its bottom centre at the position, and it is what the browser
  // focuses and outlines on a drag. The content is therefore a zero-size
  // anchor at the point, with the card (and the dot) placed from it in
  // CSS, so the box never shows as an empty outline beside the card.
  const position = { lat: at.lat, lng: at.lon };
  const dot = new gm.marker.AdvancedMarkerElement({ map, position, content: el("div", { className: "point-anchor" }, el("div", { className: "point-dot" })), zIndex: 2999 });
  const marker = new gm.marker.AdvancedMarkerElement({ map, position, content: el("div", { className: "point-anchor" }, card), gmpDraggable: true, zIndex: 3000 });
  // Dragging moves the marker to another place on the ground, which
  // would then drift away from the point as the map zooms. The card is
  // meant to stay a screen distance from the point, so at the end of a
  // drag the marker goes back to the point and the drag becomes a
  // change of the card's offset from its anchor, in pixels.
  const offset = { x: 14, y: 14 };
  card.style.left = `${offset.x}px`;
  card.style.top = `${offset.y}px`;
  marker.addListener("dragend", () => {
    const d = pixelDelta(position, marker.position);
    marker.position = position;
    offset.x += d.x;
    offset.y += d.y;
    card.style.left = `${Math.round(offset.x)}px`;
    card.style.top = `${Math.round(offset.y)}px`;
  });
  point = { card: marker, dot, lines, request, reply, at };
  $("result").replaceChildren(pointContent(reply, request, at, rows, { towersOnly: false }));
}

// pixelDelta is the screen displacement, in pixels at the map's current
// zoom, from one position to another (the map is neither tilted nor
// rotated).
function pixelDelta(from, to) {
  const gm = window.google.maps;
  const proj = map.getProjection();
  const scale = 2 ** map.getZoom();
  const a = proj.fromLatLngToPoint(new gm.LatLng(from));
  const b = proj.fromLatLngToPoint(new gm.LatLng(to));
  return { x: (b.x - a.x) * scale, y: (b.y - a.y) * scale };
}

// hidePoint removes the point's card, dot and lines (the Hide button and
// the next right click).
function hidePoint() {
  if (pointInFlight) pointInFlight.abort();
  closeProfile();
  if (!point) return;
  point.card.map = null;
  point.dot.map = null;
  for (const l of point.lines) l.setMap(null);
  point = null;
}

// pointContent builds the point's figures: with towersOnly one row per
// tower (its best radio) for the card, otherwise one row per radio for
// the panel, each with the level, the path, the distance and the bearing
// to the tower; a note explains the lines.
function pointContent(reply, request, at, rows, { towersOnly }) {
  const box = el("div");
  const cell = reply.cell || {};
  const elev = [];
  if (cell.ground != null) elev.push(`ground ${cell.ground} m`);
  if (cell.surface != null) elev.push(`surface ${cell.surface} m`);
  if (cell.vegetation) elev.push("tree");
  const head = el("p", {}, el("b", {}, `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`), ` · ${elev.join(", ")} · receiver ${heightText(request)} · status ${reply.status}`);
  if (reply.message) head.append(el("span", { className: "warn" }, ` (${reply.message})`));
  box.append(head);
  if (reply.strongest) {
    const s = reply.strongest;
    box.append(el("p", {}, "Strongest: ", el("b", {}, `${s.tower_name || s.tower} / ${s.radio_name || s.radio}`), ` at ${s.signal_dbm} dBm (${s.path.toUpperCase()})`));
  } else {
    box.append(el("p", {}, `No radio reaches this point at ${reply.min_signal_dbm} dBm or better.`));
  }
  const headRow = el("tr", {}, el("th", {}, "Tower"), el("th", {}, "Radio"), el("th", {}, "dBm"), el("th", {}, "Path"), el("th", {}, ""), el("th", {}, "km"), el("th", { title: "bearing from the point to the tower, clockwise from true north" }, "To tower"));
  if (!towersOnly) headRow.append(el("th", { title: "the point's bearing from the tower minus the radio's azimuth" }, "Off axis"), el("th", { title: "angle from the receiver up to the AP antenna" }, "Elev."));
  const table = el("table", {}, el("thead", {}, headRow));
  const tbody = el("tbody");
  const radioRow = (row, r) => {
    const tr = el("tr", {}, el("td", {}, row.tower.name || row.tower.id));
    if (!r) {
      tr.className = "skipped";
      tr.append(el("td", { colSpan: 4 }, row.skipped ? `skipped (${row.skipped})` : "no path"));
    } else {
      const title = candidateTitle(r);
      tr.append(el("td", {}, r.name || r.id));
      tr.append(el("td", { title, className: r.covered ? "" : "na" }, r.signal_dbm == null ? "–" : String(r.signal_dbm)));
      // Below the minimum: a small second line, so the column stays as
      // narrow as the path names.
      const path = el("td", { title }, r.path ? r.path.toUpperCase() : r.skipped ? `skipped (${r.skipped})` : "no path");
      if (r.path && !r.covered) path.append(el("small", { className: "below" }, "below min."));
      tr.append(path);
      // The path profile of this radio to the point, in the drawer.
      const cell = el("td");
      if (!r.skipped) {
        const link = el("button", { type: "button", className: "link", title: "Draw the path profile from this radio to the point" }, "Profile");
        link.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openProfile(row.tower.id, r);
        });
        cell.append(link);
      }
      tr.append(cell);
    }
    tr.append(el("td", {}, String(row.distance)), el("td", {}, degrees(row.azimuthToTower)));
    if (!towersOnly) tr.append(el("td", {}, r && !r.skipped ? degrees(r.off_axis_deg) : "–"), el("td", {}, r && r.elevation_deg != null ? `${r.elevation_deg}°` : "–"));
    tbody.append(tr);
  };
  for (const row of rows) {
    if (towersOnly) radioRow(row, row.radio);
    else for (const r of row.tower.radios) radioRow(row, r);
  }
  table.append(tbody);
  box.append(table);
  box.append(el("p", { className: "muted" }, "Lines: solid for line of sight, dashed for a non-line-of-sight path, grey dotted when nothing reaches the point. To tower is the bearing from the point, clockwise from true north."));
  return box;
}

// --- the path profile ---

// openProfile asks the service for the profile from one radio to the
// point of the open card, at the height of the radio's best candidate
// (or the request's one height), and shows it in the drawer with a halo
// on that tower's line on the map.
function openProfile(towerId, radio) {
  if (!point) return;
  closeProfile();
  const rxHeight = radio.rx_height || Object.keys(point.request.rx_height)[0];
  profile = { towerId, radioId: radio.id, rxHeight, request: null, reply: null, view: null, shown: null, layout: null, halo: null };
  const gm = window.google.maps;
  const t = TOWERS.find((x) => x.id === towerId);
  if (t) {
    profile.halo = new gm.Polyline({ map, path: [{ lat: point.at.lat, lng: point.at.lon }, { lat: t.lat, lng: t.lon }], geodesic: true, strokeColor: "#fff", strokeOpacity: 0.9, strokeWeight: 9, clickable: false, zIndex: 1999 });
  }
  const drawer = $("profile");
  const wasHidden = drawer.hidden;
  drawer.hidden = false;
  $("profileTitle").textContent = `${t ? t.name : towerId} / ${radio.name || radio.id} → point`;
  $("profileCaption").textContent = "";
  $("profileReadout").textContent = "";
  $("profileChart").replaceChildren();
  profileTools();
  if (wasHidden) gm.event.trigger(map, "resize");
  showView();
}

// showView draws the profile's view (null for the whole path) from the
// reply the page holds when that covers it at the step the chart needs,
// else asks the service for the window around the view (profile.js
// fetchWindow). A view that moves while a request is in flight is shown
// when the reply is in. The window the service last gave is drawn as it
// is when asking again would repeat the same request.
function showView() {
  if (!profile) return;
  const p = profile;
  const plotW = Math.max(100, $("profileChart").clientWidth - 60);
  if (p.reply && viewCovered(p.reply, p.view, plotW)) {
    renderProfile();
    return;
  }
  if (profileInFlight) {
    profileWanted = true;
    return;
  }
  const win = fetchWindow(p.view, p.reply ? p.reply.distance : 0, plotW);
  if (p.request && p.request.samples === win.samples && String(p.request.range) === String(win.range)) {
    renderProfile();
    return;
  }
  requestProfile(win);
}

// requestProfile fetches a window of the profile ({ range, samples },
// no range for the whole path) and shows the view from it.
async function requestProfile(win) {
  if (!profile || profileInFlight) return;
  const p = profile;
  const request = buildProfileRequest({ request: point.request, towerId: p.towerId, radioId: p.radioId, rxHeight: p.rxHeight, samples: win.samples, range: win.range });
  const ctl = new AbortController();
  profileInFlight = ctl;
  profileWanted = false;
  $("profileStatus").textContent = "loading…";
  try {
    const reply = await fetchProfile(API_BASE, request, { signal: ctl.signal, trace });
    if (ctl.signal.aborted || profile !== p) return;
    p.request = request;
    p.reply = reply;
    $("profileStatus").textContent = "";
    profileInFlight = null;
    showView();
  } catch (e) {
    if (e.name === "AbortError") return;
    $("profileStatus").textContent = e.message;
  } finally {
    if (profileInFlight === ctl) profileInFlight = null;
    if (profile === p && profileWanted) {
      profileWanted = false;
      showView();
    }
  }
}

// renderProfile draws the reply in the drawer at the chart's current size.
function renderProfile() {
  if (!profile || !profile.reply) return;
  const reply = viewOf(profile.reply, profile.view);
  profile.shown = reply;
  const chart = $("profileChart");
  $("profileTitle").textContent = profileTitle(reply);
  $("profileCaption").textContent = profileCaption(reply);
  const width = Math.max(200, chart.clientWidth);
  const height = Math.max(80, chart.clientHeight);
  const L = chartLayout(reply, { width, height });
  if (!L) {
    chart.replaceChildren(el("p", { className: "muted" }, reply.skipped ? `The radio was skipped (${reply.skipped}).` : "No profile."));
    profile.layout = null;
    profileTools();
    return;
  }
  profile.layout = L;
  chart.innerHTML = chartSVG(reply, L);
  profileTools();
}

// profileTools shows the range on view and enables the toolbar's buttons
// for the moves that would change it.
function profileTools() {
  const has = profile && profile.reply && profile.layout;
  const whole = !has || profile.layout.x1 - profile.layout.x0 >= profile.reply.distance;
  $("profileRange").textContent = has ? `${Math.round(profile.layout.x0)}–${Math.round(profile.layout.x1)} ${unitLabel(profile.reply)}` : "";
  $("profilePanLeft").disabled = !has || profile.layout.x0 <= 0;
  $("profilePanRight").disabled = !has || profile.layout.x1 >= profile.reply.distance;
  $("profileZoomIn").disabled = !has || profile.layout.x1 - profile.layout.x0 <= 20;
  $("profileZoomOut").disabled = whole;
  $("profileFull").disabled = whole;
}

// profileMove moves the view by a zoom or pan step and shows it. The step
// is computed on the view itself (not the chart, which may lag behind a
// request in flight), so a burst of steps compounds.
function profileMove(step) {
  if (!profile || !profile.reply || !profile.layout) return;
  const d = profile.reply.distance;
  const next = step(profile.view || [0, d], d);
  if (next) {
    profile.view = next[1] - next[0] >= d ? null : next;
    showView();
  }
}

// profileFull shows the whole path again.
function profileFull() {
  if (!profile || !profile.reply) return;
  profile.view = null;
  showView();
}

// closeProfile empties and hides the drawer and removes the halo.
function closeProfile() {
  if (profileInFlight) profileInFlight.abort();
  profileInFlight = null;
  profileWanted = false;
  if (profile && profile.halo) profile.halo.setMap(null);
  profile = null;
  const drawer = $("profile");
  if (!drawer.hidden) {
    drawer.hidden = true;
    if (map) window.google.maps.event.trigger(map, "resize");
  }
}

// wireProfile connects the drawer's controls: the toolbar (pan, zoom,
// whole path, close), hover readout, wheel zoom about the pointer, drag
// to pan, double click for the whole path, the resize handle and the
// window's resize. Every zoom or pan re-requests the range.
function wireProfile() {
  const chart = $("profileChart");
  const ZOOM = 1.5;
  $("profileClose").addEventListener("click", closeProfile);
  $("profileZoomIn").addEventListener("click", () => profileMove((r, d) => zoomRange(r, d, 0.5, ZOOM)));
  $("profileZoomOut").addEventListener("click", () => profileMove((r, d) => zoomRange(r, d, 0.5, 1 / ZOOM)));
  $("profilePanLeft").addEventListener("click", () => profileMove((r, d) => panRange(r, d, -(r[1] - r[0]) / 4)));
  $("profilePanRight").addEventListener("click", () => profileMove((r, d) => panRange(r, d, (r[1] - r[0]) / 4)));
  $("profileFull").addEventListener("click", profileFull);
  chart.addEventListener("mousemove", (ev) => {
    if (!profile || !profile.reply || !profile.layout || chart.classList.contains("dragging")) return;
    const i = binAt(profile.reply, profile.layout, ev.offsetX);
    $("profileReadout").textContent = i < 0 ? "" : readout(profile.reply, i);
  });
  chart.addEventListener("mouseleave", () => {
    $("profileReadout").textContent = "";
  });
  chart.addEventListener("wheel", (ev) => {
    if (!profile || !profile.layout) return;
    ev.preventDefault();
    const L = profile.layout;
    const f = Math.min(1, Math.max(0, (ev.offsetX - L.pad.left) / L.plotW));
    profileMove((r, d) => zoomRange(r, d, f, ev.deltaY < 0 ? ZOOM : 1 / ZOOM));
  }, { passive: false });
  chart.addEventListener("dblclick", profileFull);
  // Drag the chart to pan a zoomed range: each move asks for the range
  // shifted by the pointer's travel in path units since the last request.
  chart.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !profile || !profile.layout) return;
    const L = profile.layout;
    if (L.x1 - L.x0 >= profile.reply.distance) return;
    ev.preventDefault();
    const perPx = (L.x1 - L.x0) / L.plotW; // the view's scale: the chart always shows the view
    let lastX = ev.clientX;
    let moved = false;
    const move = (e) => {
      const dx = e.clientX - lastX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      chart.classList.add("dragging");
      lastX = e.clientX;
      profileMove((r, d) => panRange(r, d, -dx * perPx));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      chart.classList.remove("dragging");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
  // Drag the handle to change the drawer's height; the map takes the rest.
  const drawer = $("profile");
  $("profileHandle").addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = drawer.getBoundingClientRect().height;
    const move = (e) => {
      drawer.style.height = `${Math.round(startH + (startY - e.clientY))}px`;
      renderProfile();
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (map) window.google.maps.event.trigger(map, "resize");
      renderProfile();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
  window.addEventListener("resize", renderProfile);
}

// candidateTitle is the tooltip of a radio's figures: each requested
// height's link budget.
function candidateTitle(r) {
  if (r.skipped) return "";
  const parts = [];
  for (const [name, c] of Object.entries(r.candidates || {})) {
    if (!c) continue;
    let s = `${name.replace("_", " ")} (${c.rx_elevation} m)`;
    if (c.signal_dbm != null) s += `: ${c.signal_dbm} dBm ${c.path.toUpperCase()}`;
    if (c.free_space_dbm != null) s += `, free space ${c.free_space_dbm} dBm`;
    if (c.excess_loss_db != null) s += `, excess loss ${c.excess_loss_db} dB`;
    if (c.ap_gain_dbi != null) s += `, AP gain ${c.ap_gain_dbi} dBi`;
    if (c.reason) s += ` [${c.reason.replace("_", " ")}]`;
    parts.push(s);
  }
  return parts.join("\n");
}

// --- result panel ---

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function radioLabel(r) {
  return `${r.tower_name || r.tower} / ${r.radio_name || r.radio}`;
}

// renderResult fills the panel's result section.
function renderResult(reply, point) {
  const box = $("result");
  box.replaceChildren(resultContent(reply, point));
}

// openPopup shows the same result in a popup anchored to the northern
// edge of the patch (radiusM north of the clicked point), so its body
// sits above the raster instead of hiding it; the click marker still
// marks the point. There is one popup; a new result moves it and
// replaces its content.
function openPopup(reply, point, radiusM = 0) {
  const gm = window.google.maps;
  if (!popup) {
    popup = new gm.InfoWindow({ disableAutoPan: false });
  }
  const content = resultContent(reply, point, { bestOnly: true });
  content.className = "popup";
  popup.setContent(content);
  popup.setPosition({ lat: point.lat + radiusM / 111320, lng: point.lon });
  popup.open({ map, shouldFocus: false });
}

// atmosphereText describes the atmosphere the reply was computed for and
// the rain rates it used (they can differ between towers).
function atmosphereText(reply) {
  const a = reply.atmosphere || { mode: "none" };
  if (a.mode === "none") return "Atmosphere: none (free-space loss only)";
  const rates = new Set();
  for (const t of reply.towers) for (const r of t.radios) if (r.loss) rates.add(r.loss.rain_rate_mm_h.toFixed(2));
  const basis = a.rain_rate_mm_h != null ? "given" : `exceeded ${a.rain_percentile_pct}% of rainy time`;
  const rate = rates.size ? `${[...rates].join(" / ")} mm/h` : "n/a";
  return `Atmosphere: ${a.mode}, rain ${rate} (${basis}), gas and rain loss included`;
}

// figure is a radio's counted result: the nlos block (every counted
// cell, LOS and NLOS) when the reply has one for the radio, else the los
// block (NLOS off, or the radio above the NLOS frequency ceiling);
// docs/patch-api.md 4.10. null for a skipped radio.
function figure(r) {
  if (r.skipped) return null;
  return r.nlos || r.los || null;
}

// covers is true for an evaluated radio with some coverage of the patch.
function covers(r) {
  const f = figure(r);
  return Boolean(f && f.coverage_pct > 0);
}

// bestRadioRows reduces each tower to its best covering radio (most
// coverage, then strongest signal); towers without coverage are left out.
function bestRadioRows(reply) {
  const rows = [];
  for (const t of reply.towers) {
    let best = null;
    for (const r of t.radios) {
      if (!covers(r)) continue;
      const f = figure(r);
      const b = best && figure(best);
      if (!best || f.coverage_pct > b.coverage_pct ||
        (f.coverage_pct === b.coverage_pct && (f.signal_dbm ?? -Infinity) > (b.signal_dbm ?? -Infinity))) {
        best = r;
      }
    }
    if (best) rows.push({ tower: t, radio: best });
  }
  return rows;
}

// pathsText says which path types a reply counted and the receiver
// clearance it used (echoed by the service as applied).
function pathsText(reply) {
  const kinds = [];
  if (reply.enable_los) kinds.push("line of sight");
  if (reply.enable_nlos) kinds.push("non-line-of-sight (diffraction, vegetation)");
  const clearance = reply.enable_nlos && reply.rxclearance != null ? `, receiver clearance ${reply.rxclearance} m` : "";
  return `Paths: ${kinds.join(" and ")}${clearance}`;
}

// summaryLines appends the best-coverage and strongest radios of one
// summary block (los or nlos) with a label for the block.
function summaryLines(box, block, label, none) {
  const best = block?.coverage;
  const strongest = block?.strongest;
  if (best) {
    box.append(el("p", {}, `Best coverage${label}: `, el("b", {}, radioLabel(best)), ` at ${best.coverage_pct}% (${dbm(best.signal_dbm)})`));
  } else {
    box.append(el("p", {}, none));
  }
  if (strongest && (strongest.radio !== best?.radio || strongest.tower !== best?.tower)) {
    box.append(el("p", {}, `Strongest${label}: `, el("b", {}, radioLabel(strongest)), ` at ${strongest.signal_dbm} dBm (${strongest.coverage_pct}%)`));
  }
}

// figureCells appends the coverage and signal cells of a figure, or two
// "–" cells (with a title saying why) when there is none.
function figureCells(tr, f, why) {
  if (!f) {
    tr.append(el("td", { className: "na", title: why || "" }, "–"), el("td", { className: "na", title: why || "" }, "–"));
    return;
  }
  tr.append(el("td", {}, String(f.coverage_pct)), el("td", {}, f.signal_dbm == null ? "–" : String(f.signal_dbm)));
}

// resultContent builds the reply's summary and a table with one row per
// radio, or, with bestOnly, one row per tower showing its best radio.
function resultContent(reply, point, { bestOnly = false } = {}) {
  const box = el("div");
  const head = el("p", {}, el("b", {}, `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`), ` · ${reply.cells} cells${reply.cells_vegetation ? ` (${reply.cells_vegetation} trees)` : ""} · status ${reply.status}`);
  if (reply.message) head.append(el("span", { className: "warn" }, ` (${reply.message})`));
  box.append(head);
  box.append(el("p", {}, atmosphereText(reply)));
  box.append(el("p", {}, pathsText(reply)));

  // One summary per counted path type: the los block names the best
  // line-of-sight radios, the nlos block the best over every counted
  // cell (LOS and NLOS together, docs/patch-api.md 4.7 and 4.10).
  const withNLOS = Boolean(reply.enable_nlos);
  const withLOS = Boolean(reply.enable_los);
  const sum = reply.summary || {};
  if (withLOS) {
    summaryLines(box, { coverage: sum.coverage?.los, strongest: sum.strongest?.los }, withNLOS ? " (LOS)" : "", "No radio has line of sight to this patch.");
  }
  if (withNLOS) {
    summaryLines(box, { coverage: sum.coverage?.nlos, strongest: sum.strongest?.nlos }, withLOS ? " (LOS + NLOS)" : " (NLOS)", withLOS ? "No radio reaches this patch by a non-line-of-sight path either." : "No radio reaches this patch by a non-line-of-sight path.");
  }

  // Only radios that cover some of the patch are listed; skipped radios
  // and radios with no line of sight are counted in a line below.
  const rows = bestOnly ? bestRadioRows(reply) : reply.towers.flatMap((t) => t.radios.filter(covers).map((r) => ({ tower: t, radio: r })));
  const all = reply.towers.flatMap((t) => t.radios);
  const skipped = all.filter((r) => r.skipped).length;
  const blind = all.filter((r) => !r.skipped && !covers(r)).length;
  const withLoss = reply.atmosphere && reply.atmosphere.mode !== "none";
  // With both path types the table has a LOS pair and a LOS + NLOS pair
  // of columns; with one, a single pair. A radio above the NLOS frequency
  // ceiling (nlos_skipped) has no nlos figures: its cells show "–" with
  // the reason as a title, and it is counted in the note below.
  const both = withLOS && withNLOS;
  const headRow = el("tr", {}, el("th", {}, "Tower"), el("th", {}, bestOnly ? "Best radio" : "Radio"));
  if (withLOS) headRow.append(el("th", {}, both ? "LOS %" : "Cover %"), el("th", {}, "dBm"));
  if (withNLOS) headRow.append(el("th", {}, both ? "LOS+NLOS %" : "NLOS %"), el("th", {}, "dBm"));
  if (withLoss) headRow.append(el("th", {}, "dB/km"));
  const table = el("table", {}, el("thead", {}, headRow));
  const tbody = el("tbody");
  for (const { tower: t, radio: r } of rows) {
    const tr = el("tr", {}, el("td", {}, t.name || t.id), el("td", {}, r.name || r.id));
    if (withLOS) figureCells(tr, r.los, "line of sight not counted");
    if (withNLOS) figureCells(tr, r.nlos, r.nlos_skipped === "above_nlos_frequency" ? "above the NLOS frequency ceiling: line of sight only" : "not counted");
    if (withLoss) {
      // Gas plus rain specific attenuation, before the P.530 distance factor.
      const l = r.loss;
      tr.append(el("td", { title: l ? `gas ${l.gas_db_per_km} + rain ${l.rain_db_per_km} dB/km at ${l.rain_rate_mm_h} mm/h` : "" }, l ? (l.gas_db_per_km + l.rain_db_per_km).toFixed(2) : "–"));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  if (rows.length > 0) box.append(table);
  const notes = [];
  if (blind > 0) notes.push(`${blind} radio${blind === 1 ? "" : "s"} with no coverage`);
  if (skipped > 0) notes.push(`${skipped} skipped (${[...new Set(all.filter((r) => r.skipped).map((r) => r.skipped))].join(", ")})`);
  if (notes.length > 0) box.append(el("p", { className: "muted" }, `Not listed: ${notes.join("; ")}.`));
  const losOnly = all.filter((r) => !r.skipped && r.nlos_skipped === "above_nlos_frequency").length;
  if (withNLOS && losOnly > 0) box.append(el("p", { className: "muted" }, `${losOnly} radio${losOnly === 1 ? " is" : "s are"} above the NLOS frequency ceiling (28 and 60 GHz): line of sight only.`));
  return box;
}

// renderLegend draws the one key for the current mode: the signal palette
// for patches, and for buildings either the coverage ramp or the signal
// palette, depending on the colouring.
function renderLegend() {
  const box = $("legend");
  box.replaceChildren();
  const sw = (color, label, cls) => {
    const i = el("i");
    if (cls) i.className = cls;
    if (color) i.style.background = `rgb(${color.join(",")})`;
    box.append(el("span", { className: "swatch" }, i, label));
  };
  const weak = Number($("minSignalDbm").value);
  const signalStops = () => {
    const stops = [-45, -60, -75, -90, weak].filter((v, i, a) => v >= weak && a.indexOf(v) === i);
    for (const dbm of stops) sw(signalColor(dbm, { weak }), `${dbm} dBm`);
  };
  if (mode === "patch") {
    $("legendTitle").textContent = "Signal";
    signalStops();
    if ($("enableNLOS").checked) sw(null, "hatched: non-line-of-sight path (diffraction, vegetation)", "nlos");
    sw(null, "no path / below threshold / water / trees", "nodata");
    return;
  }
  if (options().colourBy === "coverage") {
    $("legendTitle").textContent = `Building coverage (cells at or above ${weak} dBm)`;
    for (const pct of [100, 75, 50, 25, 5]) sw(coverageColor(pct), `${pct}%`);
    sw(coverageColor(0), "0%");
  } else {
    $("legendTitle").textContent = "Building 3rd strongest cell";
    signalStops();
    sw(coverageColor(0), "fewer than 3 cells covered");
  }
  sw(null, "waiting", "pending");
  sw(null, "skipped by the service", "skipped");
}

// --- buildings ---

// styleBuilding is the Data layer's style function: an outline while a
// building waits for its reply, a fill by coverage or signal once it has
// one, dark grey when the service skipped it.
function styleBuilding(feature) {
  const entry = buildingResults.get(feature.getProperty("id"));
  if (!entry) {
    return { strokeColor: "#1565c0", strokeWeight: 1, fillOpacity: 0, clickable: true };
  }
  const { minSignalDbm, colourBy } = options();
  const [r, g, b] = buildingColor(entry.result, { by: colourBy, weak: minSignalDbm });
  return { strokeColor: "#333", strokeWeight: 0.5, fillColor: `rgb(${r},${g},${b})`, fillOpacity: 0.65, clickable: true };
}

function restyleBuildings() {
  if (map) map.data.setStyle(styleBuilding);
  renderLegend();
}

function buildingButtons(running) {
  $("evaluateBuildings").disabled = running || BUILDINGS.length === 0;
  $("stopBuildings").disabled = !running;
  $("clearBuildings").disabled = running || buildingResults.size === 0 && !mapHasBuildings();
}

function mapHasBuildings() {
  let any = false;
  if (map) map.data.forEach(() => (any = true));
  return any;
}

// evaluateBuildings selects the footprints within the radius of the
// ticked towers, draws them as outlines and sends them to the service in
// batches of neighbours, one request at a time, filling each building as
// its reply arrives.
async function evaluateBuildings() {
  const towers = TOWERS.filter((t) => enabled.has(t.id));
  const opts = options();
  show("buildingError", "");
  if (towers.length === 0) return show("buildingError", "enable at least one tower");
  if (!(opts.aboveSurface > 0)) return show("buildingError", "set the receiver height above the rooftop: buildings are evaluated at that height");
  if (!(opts.buildingRadius > 0)) return show("buildingError", "the radius must be positive");
  if (!checkFlags(opts, "buildingError")) return;
  const selected = selectWithin(BUILDINGS, towers, opts.buildingRadius);
  if (selected.length === 0) return show("buildingError", `no buildings within ${opts.buildingRadius} m of the ticked towers`);
  clearBuildings();
  const ctl = new AbortController();
  buildingRun = ctl;
  buildingButtons(true);
  map.data.addGeoJson({ type: "FeatureCollection", features: selected.map(toFeature) });
  const groups = batches(selected, { max: BATCH });
  let drawn = 0;
  let covered = 0;
  let skipped = 0;
  const started = performance.now();
  try {
    for (let k = 0; k < groups.length; k++) {
      show("buildingStatus", `batch ${k + 1} of ${groups.length}: ${groups[k].length} buildings, ${drawn} drawn…`);
      const req = buildBuildingRequest({ buildings: groups[k], towers, aboveSurface: opts.aboveSurface, minSignalDbm: opts.minSignalDbm, atmosphere: opts.atmosphere, enableLOS: opts.enableLOS, enableNLOS: opts.enableNLOS, rxClearance: opts.rxClearance });
      const reply = await fetchBuildings(API_BASE, req, { signal: ctl.signal, trace });
      if (ctl.signal.aborted) return;
      for (const b of reply.buildings) {
        buildingResults.set(b.id, { result: b, reply });
        const f = map.data.getFeatureById(b.id);
        if (f) f.setProperty("result", true); // triggers a restyle of this feature
        drawn++;
        if (b.skipped) skipped++;
        else if (b.combined.coverage_pct > 0) covered++;
      }
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    show("buildingStatus", `${drawn} buildings in ${secs} s: ${covered} with coverage, ${drawn - covered - skipped} without, ${skipped} skipped. Click a building for its figures.`);
  } catch (e) {
    if (e.name === "AbortError") {
      show("buildingStatus", `stopped after ${drawn} of ${selected.length} buildings`);
      return;
    }
    show("buildingError", e.message);
    show("buildingStatus", drawn ? `${drawn} of ${selected.length} buildings drawn before the error` : "");
  } finally {
    if (buildingRun === ctl) {
      buildingRun = null;
      buildingButtons(false);
    }
  }
}

function stopBuildings() {
  if (buildingRun) buildingRun.abort();
}

// clearBuildings removes every footprint and result from the map.
function clearBuildings() {
  if (buildingRun) buildingRun.abort();
  map.data.forEach((f) => map.data.remove(f));
  buildingResults.clear();
  if (popup) popup.close();
  show("buildingStatus", "");
  buildingButtons(false);
}

// openBuildingPopup shows a building's figures in a popup anchored to the
// northern edge of the footprint (its northernmost vertex, above the
// centroid), so the body sits above the building rather than over it,
// and in the result panel.
function openBuildingPopup(feature) {
  const gm = window.google.maps;
  const id = feature.getProperty("id");
  const building = BUILDINGS.find((b) => b.id === id);
  const entry = buildingResults.get(id);
  if (!building) return;
  const content = buildingContent(building, entry, { bestOnly: true });
  content.className = "popup";
  $("result").replaceChildren(buildingContent(building, entry));
  if (!popup) popup = new gm.InfoWindow({ disableAutoPan: false });
  popup.setContent(content);
  const top = Math.max(...building.rings[0].map((v) => v[1]));
  popup.setPosition({ lat: top, lng: building.centroid.lon });
  popup.open({ map, shouldFocus: false });
}

function buildingTitle(b) {
  const parts = [b.name || b.id];
  if (b.name) parts.push(`(${b.id})`);
  const kind = b.building && b.building !== "yes" ? b.building : "";
  const levels = b.levels ? `${b.levels} levels` : "";
  const extra = [kind, levels].filter(Boolean).join(", ");
  return extra ? `${parts.join(" ")} · ${extra}` : parts.join(" ");
}

// buildingContent builds a building's result: counts, the combined
// figures, the best and strongest radio, and a table of radios (one per
// tower with bestOnly, else every radio with coverage).
function buildingContent(b, entry, { bestOnly = false } = {}) {
  const box = el("div");
  box.append(el("p", {}, el("b", {}, buildingTitle(b)), ` · ${b.centroid.lat.toFixed(5)}, ${b.centroid.lon.toFixed(5)}`));
  if (!entry) {
    box.append(el("p", { className: "muted" }, "Not evaluated yet."));
    return box;
  }
  const { result: r, reply } = entry;
  const veg = r.cells_vegetation ? `, ${r.cells_vegetation} under vegetation` : "";
  const nodata = r.cells - r.cells_with_data ? `, ${r.cells - r.cells_with_data} without data` : "";
  box.append(el("p", {}, `${r.cells} cells${veg}${nodata}`));
  if (r.skipped) {
    const why = r.skipped === "ap_building" ? "hosts an access point, excluded from the search" : r.skipped;
    box.append(el("p", { className: "warn" }, `Skipped: ${why}`));
    return box;
  }
  const c = r.combined;
  box.append(el("p", {}, "Any radio: ", el("b", {}, `${c.coverage_pct}%`), ` of the cells at or above ${reply.min_signal_dbm} dBm; ${rankLabel(reply.signal_rank)} strongest cell `, el("b", {}, c.signal_dbm == null ? "–" : `${c.signal_dbm} dBm`)));
  box.append(el("p", { className: "muted" }, pathsText(reply)));
  if (r.best) {
    box.append(el("p", {}, "Best coverage: ", el("b", {}, radioLabel(r.best)), ` at ${r.best.coverage_pct}% (${dbm(r.best.signal_dbm)})`));
  } else {
    box.append(el("p", {}, reply.enable_nlos ? "No radio reaches this building." : "No radio has line of sight to this building."));
  }
  if (r.strongest && (r.strongest.radio !== r.best?.radio || r.strongest.tower !== r.best?.tower)) {
    box.append(el("p", {}, "Strongest: ", el("b", {}, radioLabel(r.strongest)), ` at ${r.strongest.signal_dbm} dBm (${r.strongest.coverage_pct}%)`));
  }
  const rows = bestOnly
    ? bestRadiosPerTower(r, reply)
    : (r.radios || []).filter((x) => !x.skipped && x.coverage_pct > 0).map((x) => {
        const tower = reply.towers.find((t) => t.id === x.tower);
        const radio = tower?.radios.find((y) => y.id === x.radio);
        return { tower, radio: { ...x, name: radio?.name || x.radio } };
      });
  if (rows.length > 0) {
    const table = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Tower"), el("th", {}, bestOnly ? "Best radio" : "Radio"), el("th", {}, "Cover %"), el("th", {}, "dBm"))));
    const tbody = el("tbody");
    for (const { tower, radio } of rows) {
      tbody.append(el("tr", {}, el("td", {}, tower?.name || tower?.id || radio.tower), el("td", {}, radio.name), el("td", {}, String(radio.coverage_pct)), el("td", {}, radio.signal_dbm == null ? "–" : String(radio.signal_dbm))));
    }
    table.append(tbody);
    box.append(table);
  }
  const all = r.radios || [];
  const skipped = all.filter((x) => x.skipped).length;
  const blind = all.filter((x) => !x.skipped && !(x.coverage_pct > 0)).length;
  const notes = [];
  if (blind > 0) notes.push(`${blind} radio${blind === 1 ? "" : "s"} with no coverage`);
  if (skipped > 0) notes.push(`${skipped} skipped (${[...new Set(all.filter((x) => x.skipped).map((x) => x.skipped))].join(", ")})`);
  if (notes.length > 0) box.append(el("p", { className: "muted" }, `Not listed: ${notes.join("; ")}.`));
  return box;
}

function rankLabel(k) {
  if (k === 1) return "the";
  const suffix = k % 10 === 1 && k !== 11 ? "st" : k % 10 === 2 && k !== 12 ? "nd" : k % 10 === 3 && k !== 13 ? "rd" : "th";
  return `${k}${suffix}`;
}

// --- debug pane ---

// trace is fetchJSON's callback: it keeps the latest exchange (the same
// record is reported again when the reply arrives) and redraws the pane.
function trace(exchange) {
  lastExchange = exchange;
  renderDebug();
}

function setDebug(open) {
  debugOpen = open;
  $("debug").hidden = !open;
  $("debugToggle").setAttribute("aria-pressed", String(open));
  renderDebug();
}

// renderDebug fills the pane with the last request and reply, pretty
// printed; long strings (the base64 raster) are shortened unless the box
// is unticked. Nothing is formatted while the pane is closed.
function renderDebug() {
  if (!debugOpen) return;
  const x = lastExchange;
  $("debugSummary").textContent = exchangeSummary(x);
  const maxString = $("debugShorten").checked ? 96 : 0;
  $("debugRequest").textContent = x ? prettyJSON(x.request, { maxString }) : "";
  let reply = "";
  if (x?.reply != null) reply = prettyJSON(x.reply, { maxString });
  else if (x?.error) reply = `(no reply: ${x.error})`;
  else if (x && x.status != null) reply = `(HTTP ${x.status}, body not JSON)`;
  else if (x) reply = "(waiting…)";
  $("debugReply").textContent = reply;
}

// copyJSON puts the full (unshortened) JSON of one side of the exchange
// on the clipboard.
async function copyJSON(side, button) {
  const x = lastExchange;
  const value = side === "request" ? x?.request : x?.reply;
  if (value === undefined || value === null) return;
  try {
    await navigator.clipboard.writeText(prettyJSON(value));
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = label), 1200);
  } catch (e) {
    button.textContent = "Copy failed";
  }
}

// --- start ---

async function start() {
  applyMode();
  $("debugToggle").addEventListener("click", () => setDebug(!debugOpen));
  $("debugShorten").addEventListener("change", renderDebug);
  $("copyRequest").addEventListener("click", (ev) => copyJSON("request", ev.currentTarget));
  $("copyReply").addEventListener("click", (ev) => copyJSON("reply", ev.currentTarget));
  for (const r of document.querySelectorAll("input[name=mode]")) r.addEventListener("change", () => r.checked && setMode(r.value));
  $("minSignalDbm").addEventListener("change", () => {
    renderLegend();
    restyleBuildings();
  });
  $("colourBy").addEventListener("change", restyleBuildings);
  for (const id of ["enableLOS", "enableNLOS"]) {
    $(id).addEventListener("change", () => {
      renderLegend();
      show("error", "");
      show("buildingError", "");
      checkFlags(options(), mode === "patch" ? "error" : "buildingError");
    });
  }
  $("clear").addEventListener("click", clearRasters);
  wireProfile();
  $("evaluateBuildings").addEventListener("click", evaluateBuildings);
  $("stopBuildings").addEventListener("click", stopBuildings);
  $("clearBuildings").addEventListener("click", clearBuildings);
  const loaded = await loadTowers(config.towersUrl || "towers.json");
  TOWERS = loaded.towers;
  MAP_CENTER = loaded.center;
  for (const t of TOWERS) enabled.add(t.id);
  renderTowerList();
  await initMap();
  // The footprints are optional: without the file the buildings mode is
  // simply disabled, with the reason shown.
  try {
    BUILDINGS = await loadBuildings(config.buildingsUrl || "buildings.json");
    $("buildingCount").textContent = `(${BUILDINGS.length} from ${config.buildingsUrl || "buildings.json"})`;
  } catch (e) {
    $("buildingCount").textContent = "(none)";
    show("buildingError", `${e.message}; run tools/fetch-osm-buildings.sh and tools/compact-buildings.py (see README)`);
  }
  buildingButtons(false);
}

start().catch((e) => show("error", e.message));
