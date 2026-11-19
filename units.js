// Length units of the page: "imperial" (feet and miles, the service's
// default) or "metric" (meters and kilometers). The setting is `units` in
// config.js; every request carries it, the service computes in meters and
// answers in the request's units, and the page shows what it gets. The
// towers file declares its own units (`units`, metric by default) and is
// converted to the page's when loaded. Page-local geometry (the radius
// circle, the building radius, the window size) is in meters and converts
// at the edges.

export const FT_PER_M = 3.28084;
export const MI_PER_KM = 0.621371;

const NAMES = {
  metric: { length: "m", distance: "km", area: "km²", long: "meters and kilometers" },
  imperial: { length: "ft", distance: "mi", area: "mi²", long: "feet and miles" },
};

// normalizeUnits checks a units setting and returns it; undefined means
// the service's default, imperial.
export function normalizeUnits(u) {
  if (u === undefined || u === null || u === "") return "imperial";
  if (u !== "metric" && u !== "imperial") throw new Error(`units must be "metric" or "imperial", not ${JSON.stringify(u)}`);
  return u;
}

export const lengthUnit = (u) => NAMES[normalizeUnits(u)].length;
export const distanceUnit = (u) => NAMES[normalizeUnits(u)].distance;
export const areaUnit = (u) => NAMES[normalizeUnits(u)].area;
export const unitsName = (u) => NAMES[normalizeUnits(u)].long;

// toMeters and fromMeters convert a length (feet or meters) to and from
// meters; kmToDistance converts kilometers to the units' distance.
export const toMeters = (v, u) => (normalizeUnits(u) === "imperial" ? v / FT_PER_M : v);
export const fromMeters = (m, u) => (normalizeUnits(u) === "imperial" ? m * FT_PER_M : m);
export const kmToDistance = (km, u) => (normalizeUnits(u) === "imperial" ? km * MI_PER_KM : km);
export const km2ToArea = (km2, u) => (normalizeUnits(u) === "imperial" ? km2 * MI_PER_KM * MI_PER_KM : km2);

// The radio fields the service reads as lengths (feet or meters) and as
// distances (miles or kilometers).
export const LENGTH_FIELDS = ["height", "height_rooftop", "apclearance"];
export const DISTANCE_FIELDS = ["range", "max_distance"];

// convertTowers returns the tower list with every radio's lengths and
// distances converted from one units setting to the other (unchanged
// when they are the same), rounded to three decimals.
export function convertTowers(towers, from, to) {
  from = normalizeUnits(from);
  to = normalizeUnits(to);
  if (from === to) return towers;
  const len = from === "metric" ? FT_PER_M : 1 / FT_PER_M;
  const dist = from === "metric" ? MI_PER_KM : 1 / MI_PER_KM;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return towers.map((t) => ({
    ...t,
    radios: t.radios.map((r) => {
      const out = { ...r };
      for (const k of LENGTH_FIELDS) if (typeof out[k] === "number") out[k] = r3(out[k] * len);
      for (const k of DISTANCE_FIELDS) if (typeof out[k] === "number") out[k] = r3(out[k] * dist);
      return out;
    }),
  }));
}

// FIELDS gives each length input of the panel its default, limits and
// step in either units (the limits are the service's: radius 1 to 100 m,
// receiver clearance 1 to 20 m; the building radius is the page's own).
export const FIELDS = {
  metric: {
    radius: { value: 20, min: 1, max: 100, step: 1 },
    aboveGround: { value: 5, min: 0, max: 60, step: 1 },
    aboveSurface: { value: 2, min: 0, max: 60, step: 1 },
    rxClearance: { value: 3, min: 1, max: 20, step: 0.5 },
    buildingRadius: { value: 1000, min: 50, max: 3000, step: 50 },
  },
  imperial: {
    radius: { value: 65, min: 3.3, max: 328, step: 1 },
    aboveGround: { value: 16, min: 0, max: 196, step: 1 },
    aboveSurface: { value: 6.5, min: 0, max: 196, step: 0.5 },
    rxClearance: { value: 10, min: 3.3, max: 65, step: 0.5 },
    buildingRadius: { value: 3300, min: 200, max: 9800, step: 100 },
  },
};
