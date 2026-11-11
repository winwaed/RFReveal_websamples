// The sample towers come from towers.json, which can be edited without
// touching any script. Its shape:
//
//   map_center     { lat, lon }: where the map opens
//   radio_defaults fields every radio gets unless it sets its own, e.g.
//                  antenna, frequency_ghz (or frequency_mhz), tilt_deg,
//                  tx_power_dbm, apclearance, range (km)
//   towers[]       { id, name, lat, lon, height | height_rooftop, radios[] }
//                  height is metres above the ground (the DTM),
//                  height_rooftop metres above the surface (the DSM: the
//                  roof of whatever stands at the coordinates); a radio may
//                  give its own instead. Every other field is passed to
//                  the service as written.
//   radios[]       { azimuth_deg, name?, id?, ...any per-radio field }
//                  id defaults to "<tower id>-<azimuth>".
//
// Heights are metres and ranges kilometres: the requests use metric units.

const MOUNT = ["height", "height_rooftop"];

// expandTowers turns the file's contents into the tower list the page
// uses: defaults filled in, mounts inherited, ids assigned. It throws on
// an unusable file.
export function expandTowers(doc) {
  if (!doc || !Array.isArray(doc.towers) || doc.towers.length === 0) {
    throw new Error("towers.json needs a non-empty towers array");
  }
  const defaults = doc.radio_defaults || {};
  const ids = new Set();
  const towers = doc.towers.map((t, ti) => {
    const where = `towers[${ti}]`;
    for (const k of ["id", "name", "lat", "lon"]) {
      if (t[k] === undefined || t[k] === null) throw new Error(`${where} lacks ${k}`);
    }
    if (ids.has(t.id)) throw new Error(`${where}: duplicate tower id ${t.id}`);
    ids.add(t.id);
    if (!Array.isArray(t.radios) || t.radios.length === 0) throw new Error(`${where} (${t.id}) has no radios`);
    const towerMount = MOUNT.filter((k) => t[k] !== undefined);
    if (towerMount.length > 1) throw new Error(`${where} (${t.id}) gives both height and height_rooftop`);
    const radios = t.radios.map((r, ri) => {
      const rwhere = `${where}.radios[${ri}]`;
      if (typeof r.azimuth_deg !== "number") throw new Error(`${rwhere} lacks azimuth_deg`);
      const radio = { ...defaults, ...r };
      radio.id = r.id ?? `${t.id}-${r.azimuth_deg}`;
      radio.name = r.name ?? `${r.azimuth_deg}°`;
      const own = MOUNT.filter((k) => r[k] !== undefined);
      if (own.length > 1) throw new Error(`${rwhere} gives both height and height_rooftop`);
      if (own.length === 0) {
        if (towerMount.length === 0) throw new Error(`${rwhere} has no height or height_rooftop, and the tower gives none`);
        radio[towerMount[0]] = t[towerMount[0]];
      }
      return radio;
    });
    const tower = { ...t, radios };
    for (const k of MOUNT) delete tower[k];
    return tower;
  });
  const c = doc.map_center;
  const center = c && typeof c.lat === "number" && typeof c.lon === "number" ? { lat: c.lat, lng: c.lon } : { lat: towers[0].lat, lng: towers[0].lon };
  return { towers, center };
}

// loadTowers fetches and expands towers.json (or another URL).
export async function loadTowers(url = "towers.json") {
  const res = await fetch(url, { cache: "reload" }); // always the file as it is now
  if (!res.ok) throw new Error(`cannot load ${url}: ${res.status} ${res.statusText}`);
  let doc;
  try {
    doc = await res.json();
  } catch (e) {
    throw new Error(`${url} is not valid JSON: ${e.message}`);
  }
  return expandTowers(doc);
}
