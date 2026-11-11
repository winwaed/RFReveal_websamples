// The elevation extent (docs/extent-api.md): the service's GeoJSON
// Feature of the area its dataset covers, drawn on the map as a grey
// mask over everything outside it. Pure functions apart from
// fetchExtent, so they are testable in Node (see test/extent.test.js).

import { fetchJSON } from "./patch.js";

// fetchExtent GETs the feature.
export function fetchExtent(base, opts) {
  return fetchJSON(base, "/api/v1/extent", null, { ...opts, method: "GET" });
}

// WORLD is the outer ring of the mask: the whole map (Web Mercator stops
// short of the poles), clockwise, with a point on each long side so the
// Maps API never takes the shorter way round the globe between corners.
export const WORLD = [
  { lat: -85, lng: -180 }, { lat: 0, lng: -180 }, { lat: 85, lng: -180 }, { lat: 85, lng: 0 }, { lat: 85, lng: 180 },
  { lat: 0, lng: 180 }, { lat: -85, lng: 180 }, { lat: -85, lng: 0 },
];

// maskPaths turns the extent feature into the paths of one Maps API
// Polygon that covers everything but the extent: the world ring first,
// then every ring of the feature as it comes. The feature's outer rings
// run counter-clockwise and its holes clockwise (RFC 7946), so against
// the clockwise world ring the islands are cut out and the holes inside
// them filled again, whichever fill rule the renderer uses.
export function maskPaths(feature) {
  const paths = [WORLD];
  const g = feature && feature.geometry;
  const polygons = !g ? [] : g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
  for (const rings of polygons) {
    for (const ring of rings) paths.push(ring.map(([lng, lat]) => ({ lat, lng })));
  }
  return paths;
}

// extentSummary describes the feature for the panel: the dataset, its
// area and how many islands and holes it has.
export function extentSummary(feature) {
  const p = (feature && feature.properties) || {};
  const parts = [];
  if (p.name) parts.push(p.name);
  if (p.area_km2 != null) parts.push(`${Math.round(p.area_km2)} km²`);
  if (p.tiles != null) parts.push(`${p.tiles} tiles`);
  if (p.islands > 1) parts.push(`${p.islands} islands`);
  if (p.holes > 0) parts.push(`${p.holes} hole${p.holes === 1 ? "" : "s"}`);
  return parts.join(", ");
}
